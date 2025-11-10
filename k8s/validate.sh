#!/bin/bash
# Validation script for Citus Kubernetes deployment
# Run this before deploying to catch common issues

set -e

echo "=== Citus Kubernetes Deployment Validator ==="
echo ""

ERRORS=0
WARNINGS=0

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

error() {
    echo -e "${RED}✗ ERROR: $1${NC}"
    ERRORS=$((ERRORS + 1))
}

warning() {
    echo -e "${YELLOW}⚠ WARNING: $1${NC}"
    WARNINGS=$((WARNINGS + 1))
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

info() {
    echo "ℹ $1"
}

# Check prerequisites
echo "1. Checking prerequisites..."

if ! command -v kubectl &> /dev/null; then
    error "kubectl not found. Install kubectl to proceed."
else
    success "kubectl found: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
fi

if ! command -v docker &> /dev/null; then
    warning "docker not found. You'll need docker to build the custom image."
else
    success "docker found: $(docker --version)"
fi

if ! command -v helm &> /dev/null; then
    warning "helm not found. You'll need helm to install the postgres-operator."
else
    success "helm found: $(helm version --short)"
fi

echo ""

# Check environment configuration
echo "2. Checking environment configuration..."

if [ ! -f .env ]; then
    warning ".env file not found. Copy .env.example to .env and configure."
else
    success ".env file exists"

    # Source and validate
    source .env

    if [ -z "$DOCKER_REGISTRY" ] || [ "$DOCKER_REGISTRY" = "your-registry.io" ]; then
        error "DOCKER_REGISTRY not configured in .env"
    else
        success "DOCKER_REGISTRY configured: $DOCKER_REGISTRY"
    fi

    if [ -z "$IMAGE_TAG" ]; then
        error "IMAGE_TAG not set in .env"
    else
        success "IMAGE_TAG configured: $IMAGE_TAG"
    fi
fi

echo ""

# Validate YAML syntax
echo "3. Validating YAML syntax..."

for file in coordinator/*.yaml workers/*.yaml operator/*.yaml; do
    if [ -f "$file" ]; then
        if command -v yamllint &> /dev/null; then
            if yamllint -d relaxed "$file" > /dev/null 2>&1; then
                success "$file - valid YAML"
            else
                error "$file - YAML syntax errors"
            fi
        else
            # Basic check with kubectl
            if command -v kubectl &> /dev/null; then
                if kubectl apply --dry-run=client -f "$file" > /dev/null 2>&1; then
                    success "$file - valid Kubernetes resource"
                else
                    warning "$file - kubectl validation failed (might need CRDs installed)"
                fi
            else
                info "$file - skipped (install yamllint or kubectl for validation)"
            fi
        fi
    fi
done

echo ""

# Check Kubernetes cluster access
echo "4. Checking Kubernetes cluster access..."

if command -v kubectl &> /dev/null; then
    if kubectl cluster-info > /dev/null 2>&1; then
        success "Connected to Kubernetes cluster: $(kubectl config current-context)"

        # Check if postgres-operator is installed
        if kubectl get ns postgres-operator > /dev/null 2>&1; then
            success "postgres-operator namespace exists"

            if kubectl get pods -n postgres-operator | grep -q postgres-operator; then
                success "postgres-operator is running"
            else
                warning "postgres-operator namespace exists but operator not running"
            fi
        else
            warning "postgres-operator not installed. Run: make install-operator"
        fi
    else
        warning "Not connected to a Kubernetes cluster"
    fi
else
    info "kubectl not available - skipping cluster checks"
fi

echo ""

# Validate docker image references
echo "5. Validating Docker image configuration..."

EXPECTED_VERSION="17-4.0-p3"
EXPECTED_PG_VERSION="17"
EXPECTED_CITUS_VERSION="13.2"

# Check Dockerfile
if grep -q "postgresql-17-citus-13.2" docker/Dockerfile.spilo-citus-pgvector; then
    success "Dockerfile uses Citus 13.2"
else
    error "Dockerfile doesn't specify Citus 13.2"
fi

if grep -q "postgresql-17-pgvector" docker/Dockerfile.spilo-citus-pgvector; then
    success "Dockerfile uses PostgreSQL 17 pgvector"
else
    error "Dockerfile doesn't specify PostgreSQL 17 pgvector"
fi

if grep -q "FROM ghcr.io/zalando/spilo-17:4.0-p3" docker/Dockerfile.spilo-citus-pgvector; then
    success "Dockerfile uses correct base image (spilo-17:4.0-p3)"
else
    warning "Dockerfile base image might be outdated"
fi

# Check manifests
for file in coordinator/*.yaml workers/*.yaml; do
    if grep -q 'version: "17"' "$file"; then
        success "$file uses PostgreSQL 17"
    else
        error "$file doesn't specify PostgreSQL 17"
    fi
done

echo ""

# Check for common configuration issues
echo "6. Checking for common configuration issues..."

# Check if image registry is set
if grep -q "<your-registry>" coordinator/*.yaml workers/*.yaml 2>/dev/null; then
    error "Found placeholder <your-registry> in manifests. Update with your actual registry."
else
    success "No placeholder registry values found"
fi

# Check storage classes
if grep -q "storageClass: standard" coordinator/*.yaml workers/*.yaml; then
    warning "Using 'standard' storage class. Verify this exists in your cluster or update to your storage class."
fi

# Check resource limits
if ! grep -q "cpu:" coordinator/*.yaml; then
    warning "No CPU limits defined in coordinator manifest"
fi

echo ""

# Check sidecar configuration
echo "7. Validating worker registration configuration..."

for worker_file in workers/*.yaml; do
    if grep -q "citus-worker-registrar" "$worker_file"; then
        success "$(basename $worker_file) has worker registrar sidecar"
    else
        error "$(basename $worker_file) missing worker registrar sidecar"
    fi

    if grep -q "citus_add_node" "$worker_file"; then
        success "$(basename $worker_file) has worker registration command"
    else
        error "$(basename $worker_file) missing worker registration command"
    fi
done

echo ""

# Final summary
echo "=== Validation Summary ==="
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Ready to deploy.${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found. Review before deploying.${NC}"
    exit 0
else
    echo -e "${RED}✗ $ERRORS error(s) and $WARNINGS warning(s) found. Fix errors before deploying.${NC}"
    exit 1
fi
