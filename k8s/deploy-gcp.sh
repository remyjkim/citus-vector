#!/bin/bash
# Automated deployment script for GCP/GKE
# This script handles the complete deployment process

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "=== Citus Cluster GCP Deployment ==="
echo ""

# Check prerequisites
info "Checking prerequisites..."

command -v gcloud >/dev/null 2>&1 || error "gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
command -v kubectl >/dev/null 2>&1 || error "kubectl not found. Install from: https://kubernetes.io/docs/tasks/tools/"
command -v helm >/dev/null 2>&1 || error "helm not found. Install from: https://helm.sh/docs/intro/install/"
command -v docker >/dev/null 2>&1 || error "docker not found. Install from: https://docs.docker.com/get-docker/"

success "All prerequisites found"
echo ""

# Configuration
info "Setting up configuration..."

# Prompt for GCP project ID if not set
if [ -z "$PROJECT_ID" ]; then
    echo "Enter your GCP Project ID:"
    read -r PROJECT_ID
fi

# Set defaults
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
CLUSTER_NAME="${CLUSTER_NAME:-citus-cluster}"
MACHINE_TYPE="${MACHINE_TYPE:-n2-standard-4}"
NUM_NODES="${NUM_NODES:-3}"

info "Configuration:"
echo "  Project ID: $PROJECT_ID"
echo "  Region: $REGION"
echo "  Zone: $ZONE"
echo "  Cluster Name: $CLUSTER_NAME"
echo "  Machine Type: $MACHINE_TYPE"
echo "  Number of Nodes: $NUM_NODES"
echo ""

echo "Proceed with this configuration? [y/N]"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    error "Deployment cancelled"
fi

# Set gcloud project
info "Setting up GCP project..."
gcloud config set project "$PROJECT_ID" || error "Failed to set project"
success "Project set: $PROJECT_ID"
echo ""

# Enable required APIs
info "Enabling required GCP APIs (this may take a few minutes)..."
gcloud services enable container.googleapis.com --quiet || warning "Container API already enabled or failed"
gcloud services enable compute.googleapis.com --quiet || warning "Compute API already enabled or failed"
gcloud services enable artifactregistry.googleapis.com --quiet || warning "Artifact Registry API already enabled or failed"
success "APIs enabled"
echo ""

# Check if cluster exists
if gcloud container clusters describe "$CLUSTER_NAME" --region="$REGION" >/dev/null 2>&1; then
    warning "Cluster $CLUSTER_NAME already exists"
    echo "Use existing cluster? [y/N]"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        SKIP_CLUSTER_CREATE=true
    else
        error "Please delete the existing cluster or choose a different name"
    fi
fi

# Create GKE cluster
if [ "$SKIP_CLUSTER_CREATE" != "true" ]; then
    info "Creating GKE cluster (this will take 5-10 minutes)..."
    gcloud container clusters create "$CLUSTER_NAME" \
        --region="$REGION" \
        --num-nodes=1 \
        --node-locations="$ZONE" \
        --machine-type="$MACHINE_TYPE" \
        --disk-size=100 \
        --disk-type=pd-ssd \
        --enable-autorepair \
        --enable-autoupgrade \
        --enable-autoscaling \
        --min-nodes=1 \
        --max-nodes=5 \
        --enable-stackdriver-kubernetes \
        --addons=HorizontalPodAutoscaling,HttpLoadBalancing,GcePersistentDiskCsiDriver \
        --quiet || error "Failed to create cluster"
    success "Cluster created: $CLUSTER_NAME"
else
    success "Using existing cluster: $CLUSTER_NAME"
fi
echo ""

# Get cluster credentials
info "Getting cluster credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" --region="$REGION" || error "Failed to get credentials"
success "Credentials configured"
echo ""

# Verify cluster access
info "Verifying cluster access..."
kubectl cluster-info >/dev/null 2>&1 || error "Cannot access cluster"
success "Cluster accessible"
echo ""

# Create Artifact Registry repository
info "Setting up Artifact Registry..."
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/citus-images"

if gcloud artifacts repositories describe citus-images --location="$REGION" >/dev/null 2>&1; then
    warning "Artifact Registry repository 'citus-images' already exists"
else
    gcloud artifacts repositories create citus-images \
        --repository-format=docker \
        --location="$REGION" \
        --description="Citus PostgreSQL images" \
        --quiet || error "Failed to create Artifact Registry"
    success "Artifact Registry created"
fi

# Configure Docker authentication
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
success "Docker authentication configured"
echo ""

# Build and push image
info "Building custom Spilo image (this may take 5-10 minutes)..."
IMAGE_NAME="spilo-citus-pgvector"
IMAGE_TAG="17-4.0-p3"
IMAGE_FULL="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

cd docker
docker build -f Dockerfile.spilo-citus-pgvector -t "$IMAGE_FULL" . || error "Failed to build image"
success "Image built"

info "Pushing image to Artifact Registry..."
docker push "$IMAGE_FULL" || error "Failed to push image"
success "Image pushed: $IMAGE_FULL"
cd ..
echo ""

# Update manifests
info "Updating Kubernetes manifests..."

# Update coordinator
sed -i.bak "s|dockerImage:.*|dockerImage: ${IMAGE_FULL}|g" coordinator/citus-coordinator.yaml
sed -i.bak "s|storageClass: standard|storageClass: standard-rwo|g" coordinator/citus-coordinator.yaml

# Update workers
sed -i.bak "s|dockerImage:.*|dockerImage: ${IMAGE_FULL}|g" workers/*.yaml
sed -i.bak "s|storageClass: standard|storageClass: standard-rwo|g" workers/*.yaml

# Clean up backup files
rm -f coordinator/*.bak workers/*.bak

success "Manifests updated for GCP"
echo ""

# Install Postgres Operator
info "Installing Postgres Operator..."

if helm list -n postgres-operator | grep -q postgres-operator; then
    warning "Postgres Operator already installed"
else
    helm repo add postgres-operator-charts https://opensource.zalando.com/postgres-operator/charts/postgres-operator --force-update
    helm repo update
    helm install postgres-operator postgres-operator-charts/postgres-operator \
        --namespace postgres-operator \
        --create-namespace \
        --wait || error "Failed to install Postgres Operator"
    success "Postgres Operator installed"
fi
echo ""

# Deploy Citus cluster
info "Deploying Citus cluster..."

# Deploy operator config
kubectl apply -f operator/configmap.yaml || error "Failed to apply operator config"
success "Operator configured"

# Deploy coordinator
info "Deploying coordinator (this will take 3-5 minutes)..."
kubectl apply -f coordinator/citus-coordinator.yaml || error "Failed to deploy coordinator"

# Wait for coordinator
info "Waiting for coordinator to be ready..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=600s || \
    error "Coordinator failed to become ready. Check: kubectl get pods -l cluster-name=citus-coordinator"
success "Coordinator ready"

# Deploy workers
info "Deploying workers (this will take 3-5 minutes each)..."
kubectl apply -f workers/citus-worker.yaml || error "Failed to deploy worker 1"
kubectl apply -f workers/citus-worker-2.yaml || error "Failed to deploy worker 2"

# Wait for workers
info "Waiting for workers to be ready..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=600s || \
    warning "Worker 1 not ready yet"
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=600s || \
    warning "Worker 2 not ready yet"
success "Workers deployed"
echo ""

# Verify deployment
info "Verifying deployment..."
echo ""
echo "PostgreSQL Clusters:"
kubectl get postgresql
echo ""
echo "Pods:"
kubectl get pods -l app=citus
echo ""
echo "Services:"
kubectl get svc -l app=citus
echo ""

# Get password
PGPASSWORD=$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
    -o jsonpath='{.data.password}' 2>/dev/null | base64 --decode || echo "")

if [ -z "$PGPASSWORD" ]; then
    warning "Could not retrieve password yet. Cluster may still be initializing."
else
    success "Cluster deployed successfully!"
    echo ""
    echo "=== Connection Information ==="
    echo "Coordinator password: $PGPASSWORD"
    echo ""
    echo "To connect:"
    echo "  1. Port forward: kubectl port-forward svc/citus-coordinator 5432:5432"
    echo "  2. Connect: psql -h localhost -U postgres"
    echo ""
    echo "Or save to ~/.pgpass:"
    echo "  echo \"localhost:5432:*:postgres:${PGPASSWORD}\" >> ~/.pgpass"
    echo "  chmod 600 ~/.pgpass"
fi

echo ""
echo "=== Deployment Summary ==="
echo "✓ GKE Cluster: $CLUSTER_NAME"
echo "✓ Region: $REGION"
echo "✓ Image: $IMAGE_FULL"
echo "✓ Coordinator: 2 replicas"
echo "✓ Workers: 2 workers × 2 replicas"
echo ""
echo "View full deployment guide: cat GCP_DEPLOYMENT.md"
echo ""

# Offer to port forward
echo "Start port forward now to test connection? [y/N]"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    info "Starting port forward (Ctrl+C to stop)..."
    kubectl port-forward svc/citus-coordinator 5432:5432
fi

echo ""
success "Deployment complete!"
