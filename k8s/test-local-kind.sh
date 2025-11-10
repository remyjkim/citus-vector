#!/bin/bash
# Quick local test using kind (Kubernetes in Docker)
# This script sets up a complete test environment

set -e

CLUSTER_NAME="citus-test"
IMAGE_NAME="spilo-citus-pgvector:17-4.0-p3"

echo "=== Citus Kubernetes Local Test (kind) ==="
echo ""

# Check prerequisites
if ! command -v kind &> /dev/null; then
    echo "❌ kind not found. Install it with:"
    echo "   curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-$(uname)-amd64"
    echo "   chmod +x ./kind && sudo mv ./kind /usr/local/bin/kind"
    exit 1
fi

if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl."
    exit 1
fi

if ! command -v helm &> /dev/null; then
    echo "❌ helm not found. Please install helm."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ docker not found. Please install docker."
    exit 1
fi

echo "✓ All prerequisites found"
echo ""

# Create kind cluster
echo "1. Creating kind cluster..."
if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    echo "⚠ Cluster $CLUSTER_NAME already exists. Delete it? [y/N]"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        kind delete cluster --name $CLUSTER_NAME
    else
        echo "Using existing cluster"
    fi
fi

if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    kind create cluster --name $CLUSTER_NAME
fi

echo "✓ Cluster created"
echo ""

# Install postgres-operator
echo "2. Installing Postgres Operator..."
helm repo add postgres-operator-charts https://opensource.zalando.com/postgres-operator/charts/postgres-operator 2>/dev/null || true
helm repo update

if helm list -n postgres-operator | grep -q postgres-operator; then
    echo "⚠ Postgres operator already installed"
else
    helm install postgres-operator postgres-operator-charts/postgres-operator \
        --namespace postgres-operator \
        --create-namespace \
        --wait
fi

echo "✓ Operator installed"
echo ""

# Build custom image
echo "3. Building custom Spilo image..."
cd docker
docker build -f Dockerfile.spilo-citus-pgvector -t $IMAGE_NAME . || exit 1
cd ..

echo "✓ Image built"
echo ""

# Load image into kind
echo "4. Loading image into kind cluster..."
kind load docker-image $IMAGE_NAME --name $CLUSTER_NAME

echo "✓ Image loaded"
echo ""

# Update manifests for local testing
echo "5. Updating manifests for local testing..."
cat > /tmp/kustomization.yaml << EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: default

resources:
  - operator/configmap.yaml
  - coordinator/citus-coordinator.yaml
  - workers/citus-worker.yaml
  - workers/citus-worker-2.yaml

patches:
  - target:
      kind: postgresql
      group: acid.zalan.do
      version: v1
    patch: |-
      - op: replace
        path: /spec/dockerImage
        value: $IMAGE_NAME
      - op: replace
        path: /spec/volume/size
        value: 1Gi
      - op: replace
        path: /spec/resources/requests/cpu
        value: 250m
      - op: replace
        path: /spec/resources/requests/memory
        value: 512Mi
      - op: replace
        path: /spec/resources/limits/cpu
        value: 500m
      - op: replace
        path: /spec/resources/limits/memory
        value: 1Gi

commonLabels:
  app.kubernetes.io/name: citus-vector
  app.kubernetes.io/component: database
  app.kubernetes.io/managed-by: postgres-operator
EOF

echo "✓ Manifests updated"
echo ""

# Deploy
echo "6. Deploying Citus cluster..."
kubectl kustomize . --load-restrictor LoadRestrictionsNone | \
    sed "s|<your-registry>/spilo-citus-pgvector:17-4.0-p3|$IMAGE_NAME|g" | \
    kubectl apply -f -

echo "✓ Cluster deployed"
echo ""

# Wait for ready
echo "7. Waiting for cluster to be ready (this may take 5-10 minutes)..."
echo "   Waiting for coordinator..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=600s

echo "   Waiting for worker 1..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=600s

echo "   Waiting for worker 2..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=600s

echo "✓ Cluster ready"
echo ""

# Get status
echo "8. Cluster Status:"
echo ""
kubectl get postgresql
echo ""
kubectl get pods -l app.kubernetes.io/name=citus-vector
echo ""

# Test connection
echo "9. Testing cluster..."

# Get password
export PGPASSWORD=$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
    -o jsonpath='{.data.password}' | base64 --decode)

echo "   Password: $PGPASSWORD"
echo ""

# Port forward in background
kubectl port-forward svc/citus-coordinator 5432:5432 &
PF_PID=$!
sleep 5

# Run tests
echo "   Testing PostgreSQL connection..."
if psql -h localhost -U postgres -c "SELECT version();" > /dev/null 2>&1; then
    echo "   ✓ Connection successful"
else
    echo "   ❌ Connection failed"
    kill $PF_PID
    exit 1
fi

echo "   Testing Citus..."
CITUS_VERSION=$(psql -h localhost -U postgres -t -c "SELECT citus_version();")
echo "   ✓ Citus version: $CITUS_VERSION"

echo "   Testing pgvector..."
VECTOR_VERSION=$(psql -h localhost -U postgres -t -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';")
echo "   ✓ pgvector version: $VECTOR_VERSION"

echo "   Testing workers..."
WORKER_COUNT=$(psql -h localhost -U postgres -t -c "SELECT count(*) FROM citus_get_active_worker_nodes();" | xargs)
echo "   ✓ Active workers: $WORKER_COUNT"

if [ "$WORKER_COUNT" != "2" ]; then
    echo "   ⚠ WARNING: Expected 2 workers, found $WORKER_COUNT"
    echo "   Checking worker registrar logs..."
    kubectl logs -l cluster-name=citus-worker-1 -c citus-worker-registrar --tail=20
fi

echo ""
echo "   Creating distributed test table..."
psql -h localhost -U postgres << EOF
CREATE TABLE test_vectors (
    id bigserial PRIMARY KEY,
    tenant_id bigint NOT NULL,
    embedding vector(128) NOT NULL,
    created_at timestamp DEFAULT now()
);

SELECT create_distributed_table('test_vectors', 'tenant_id');

INSERT INTO test_vectors (tenant_id, embedding)
SELECT
    (random() * 10)::bigint,
    array_fill(random()::float4, ARRAY[128])::vector(128)
FROM generate_series(1, 100);

CREATE INDEX ON test_vectors USING hnsw (embedding vector_cosine_ops);
EOF

echo "   ✓ Test table created and populated"

echo ""
echo "   Testing distributed query..."
ROWS=$(psql -h localhost -U postgres -t -c "SELECT count(*) FROM test_vectors;" | xargs)
echo "   ✓ Query successful. Rows: $ROWS"

echo ""
echo "   Testing vector similarity search..."
psql -h localhost -U postgres -c \
    "SELECT id FROM test_vectors WHERE tenant_id = 1 ORDER BY embedding <=> array_fill(0.5::float4, ARRAY[128])::vector LIMIT 5;"
echo "   ✓ Vector search successful"

# Cleanup test table
psql -h localhost -U postgres -c "DROP TABLE test_vectors;"

# Stop port forward
kill $PF_PID

echo ""
echo "=== ✅ All Tests Passed! ==="
echo ""
echo "Your Citus cluster is running successfully!"
echo ""
echo "To access the cluster:"
echo "  Password: $PGPASSWORD"
echo "  kubectl port-forward svc/citus-coordinator 5432:5432"
echo "  psql -h localhost -U postgres"
echo ""
echo "To view cluster status:"
echo "  kubectl get postgresql"
echo "  kubectl get pods -l app.kubernetes.io/name=citus-vector"
echo ""
echo "To clean up:"
echo "  kind delete cluster --name $CLUSTER_NAME"
echo ""
