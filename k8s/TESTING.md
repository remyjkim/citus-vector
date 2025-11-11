# Testing Guide for Citus Kubernetes Deployment

This guide helps you validate and test the Kubernetes deployment before and after deploying to your cluster.

## Pre-Deployment Testing

### 1. Run the Validation Script

```bash
cd k8s
./validate.sh
```

This script checks:
- ✅ Prerequisites (kubectl, docker, helm)
- ✅ Environment configuration
- ✅ YAML syntax
- ✅ Kubernetes cluster access
- ✅ Docker image configuration
- ✅ Common configuration issues

### 2. Validate YAML Files Manually

Using kubectl dry-run:

```bash
# Validate coordinator
kubectl apply --dry-run=client -f coordinator/citus-coordinator.yaml

# Validate workers
kubectl apply --dry-run=client -f workers/citus-worker.yaml
kubectl apply --dry-run=client -f workers/citus-worker-2.yaml

# Validate operator config
kubectl apply --dry-run=client -f operator/
```

Using kubeval (if installed):

```bash
kubeval coordinator/citus-coordinator.yaml
kubeval workers/*.yaml
```

### 3. Test with Kustomize

```bash
# Build and validate kustomize config
kubectl kustomize . | kubectl apply --dry-run=client -f -
```

## Local Testing with kind

For local testing, you can use [kind](https://kind.sigs.k8s.io/) (Kubernetes in Docker):

### Setup kind Cluster

```bash
# Install kind (if not already installed)
# Linux/Mac:
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind

# Create cluster
kind create cluster --name citus-test

# Verify
kubectl cluster-info --context kind-citus-test
```

### Install Postgres Operator

```bash
# Add Helm repo
helm repo add postgres-operator-charts https://opensource.zalando.com/postgres-operator/charts/postgres-operator
helm repo update

# Install operator
helm install postgres-operator postgres-operator-charts/postgres-operator \
  --namespace postgres-operator \
  --create-namespace

# Verify installation
kubectl get pods -n postgres-operator
```

### Load Custom Image to kind

Since kind runs locally, you need to load your custom image:

```bash
# Build image locally
cd docker
docker build -f Dockerfile.spilo-citus-pgvector \
  -t spilo-citus-pgvector:17-4.0-p3 .

# Load into kind cluster
kind load docker-image spilo-citus-pgvector:17-4.0-p3 --name citus-test

# Update manifests to use local image (no registry prefix)
# In coordinator/citus-coordinator.yaml and workers/*.yaml:
# Change: dockerImage: <your-registry>/spilo-citus-pgvector:17-4.0-p3
# To: dockerImage: spilo-citus-pgvector:17-4.0-p3
```

## Deployment Testing

### 1. Deploy Step-by-Step

```bash
# Deploy operator config
kubectl apply -f operator/configmap.yaml

# Deploy coordinator
kubectl apply -f coordinator/citus-coordinator.yaml

# Wait for coordinator to be ready
kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=300s

# Check coordinator status
kubectl get postgresql citus-coordinator
kubectl get pods -l cluster-name=citus-coordinator

# Deploy first worker
kubectl apply -f workers/citus-worker.yaml

# Wait for worker
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=300s

# Deploy second worker
kubectl apply -f workers/citus-worker-2.yaml

# Wait for second worker
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=300s
```

### 2. Verify Cluster Health

```bash
# Check all PostgreSQL clusters
kubectl get postgresql

# Expected output:
# NAME                TEAM   VERSION   PODS   VOLUME   CPU-REQUEST   MEMORY-REQUEST   AGE   STATUS
# citus-coordinator   citus  17        2      10Gi     1000m         4Gi              5m    Running
# citus-worker-1      citus  17        2      50Gi     2000m         8Gi              3m    Running
# citus-worker-2      citus  17        2      50Gi     2000m         8Gi              2m    Running

# Check all pods
kubectl get pods -l app=citus

# Check services
kubectl get svc -l app=citus

# Check PVCs
kubectl get pvc -l app=citus
```

### 3. Check Logs

```bash
# Coordinator logs
kubectl logs -l cluster-name=citus-coordinator,spilo-role=master --tail=50

# Worker logs
kubectl logs -l cluster-name=citus-worker-1,spilo-role=master --tail=50

# Worker registrar sidecar logs
kubectl logs -l cluster-name=citus-worker-1 -c citus-worker-registrar --tail=50
```

### 4. Verify Citus Cluster

Get the coordinator password:

```bash
export PGPASSWORD=$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
  -o jsonpath='{.data.password}' | base64 --decode)
echo $PGPASSWORD
```

Connect to coordinator:

```bash
# Port forward
kubectl port-forward svc/citus-coordinator 5432:5432 &

# Connect with psql
psql -h localhost -U postgres -c "SELECT version();"
```

Verify Citus extensions and workers:

```sql
-- Check PostgreSQL version
SELECT version();
-- Should show: PostgreSQL 17.x

-- Check installed extensions
SELECT * FROM pg_extension WHERE extname IN ('citus', 'vector');
-- Should show both citus and vector extensions

-- Check Citus version
SELECT citus_version();
-- Should show: Citus 13.2.x

-- Check active workers
SELECT * FROM citus_get_active_worker_nodes();
-- Should show 2 workers:
-- nodename         | nodeport
-- citus-worker-1   | 5432
-- citus-worker-2   | 5432

-- Check worker health
SELECT * FROM citus_check_cluster_node_health();
```

### 5. Test Distributed Tables

```sql
-- Create a test table with vectors
CREATE TABLE test_vectors (
    id bigserial PRIMARY KEY,
    tenant_id bigint NOT NULL,
    embedding vector(128) NOT NULL,
    metadata jsonb,
    created_at timestamp DEFAULT now()
);

-- Distribute the table
SELECT create_distributed_table('test_vectors', 'tenant_id');

-- Create vector index
CREATE INDEX ON test_vectors USING hnsw (embedding vector_cosine_ops);

-- Check distribution
SELECT * FROM citus_tables;

-- Check shards
SELECT * FROM citus_shards WHERE table_name::text = 'test_vectors';

-- Insert test data
INSERT INTO test_vectors (tenant_id, embedding, metadata)
SELECT
    (random() * 100)::bigint,
    array_fill(random()::float4, ARRAY[128])::vector(128),
    jsonb_build_object('test', true, 'batch', generate_series)
FROM generate_series(1, 1000);

-- Test router query (fast - single shard)
EXPLAIN ANALYZE
SELECT id, embedding <=> array_fill(0.5::float4, ARRAY[128])::vector AS distance
FROM test_vectors
WHERE tenant_id = 1
ORDER BY embedding <=> array_fill(0.5::float4, ARRAY[128])::vector
LIMIT 10;

-- Test parallel query (slower - all shards)
EXPLAIN ANALYZE
SELECT id, embedding <=> array_fill(0.5::float4, ARRAY[128])::vector AS distance
FROM test_vectors
ORDER BY embedding <=> array_fill(0.5::float4, ARRAY[128])::vector
LIMIT 10;

-- Verify data distribution
SELECT
    citus_worker.nodename,
    count(*) as row_count
FROM test_vectors
JOIN pg_dist_shard ON (test_vectors.tenant_id >= shardminvalue::bigint AND test_vectors.tenant_id <= shardmaxvalue::bigint)
JOIN pg_dist_placement ON (pg_dist_shard.shardid = pg_dist_placement.shardid)
JOIN pg_dist_node AS citus_worker ON (pg_dist_placement.groupid = citus_worker.groupid)
WHERE pg_dist_shard.logicalrelid = 'test_vectors'::regclass
GROUP BY citus_worker.nodename
ORDER BY citus_worker.nodename;
```

## Failover Testing

### Test Coordinator Failover

```bash
# Delete coordinator primary pod
COORDINATOR_MASTER=$(kubectl get pods -l cluster-name=citus-coordinator,spilo-role=master -o name)
kubectl delete $COORDINATOR_MASTER

# Watch failover happen
kubectl get pods -l cluster-name=citus-coordinator -w

# Verify new master elected (should take < 30 seconds)
kubectl get pods -l cluster-name=citus-coordinator,spilo-role=master

# Verify cluster still works
kubectl port-forward svc/citus-coordinator 5432:5432 &
psql -h localhost -U postgres -c "SELECT * FROM citus_get_active_worker_nodes();"
```

### Test Worker Failover

```bash
# Delete worker primary pod
WORKER_MASTER=$(kubectl get pods -l cluster-name=citus-worker-1,spilo-role=master -o name)
kubectl delete $WORKER_MASTER

# Watch failover
kubectl get pods -l cluster-name=citus-worker-1 -w

# Verify worker still registered
psql -h localhost -U postgres -c "SELECT * FROM citus_get_active_worker_nodes();"

# Test queries still work
psql -h localhost -U postgres -c "SELECT count(*) FROM test_vectors;"
```

## Performance Testing

### Basic Benchmarks

```sql
-- Test insert performance
\timing on

-- Router query performance (should be < 20ms)
SELECT id, embedding <=> array_fill(0.5::float4, ARRAY[128])::vector AS distance
FROM test_vectors
WHERE tenant_id = 1
ORDER BY embedding <=> array_fill(0.5::float4, ARRAY[128])::vector
LIMIT 10;

-- Parallel query performance (should be < 200ms for 1000 rows)
SELECT id, embedding <=> array_fill(0.5::float4, ARRAY[128])::vector AS distance
FROM test_vectors
ORDER BY embedding <=> array_fill(0.5::float4, ARRAY[128])::vector
LIMIT 10;

-- Insert performance
INSERT INTO test_vectors (tenant_id, embedding, metadata)
SELECT
    (random() * 100)::bigint,
    array_fill(random()::float4, ARRAY[128])::vector(128),
    jsonb_build_object('test', true)
FROM generate_series(1, 10000);
```

### Load Testing

Using pgbench:

```bash
# Create pgbench schema (distributed)
kubectl exec -it citus-coordinator-0 -- \
  createdb -U postgres pgbench

# Initialize
kubectl exec -it citus-coordinator-0 -- \
  pgbench -i -U postgres pgbench

# Distribute tables
kubectl exec -it citus-coordinator-0 -- psql -U postgres pgbench << EOF
SELECT create_distributed_table('pgbench_accounts', 'aid');
SELECT create_distributed_table('pgbench_branches', 'bid');
SELECT create_distributed_table('pgbench_tellers', 'tid');
SELECT create_distributed_table('pgbench_history', 'aid');
EOF

# Run benchmark
kubectl exec -it citus-coordinator-0 -- \
  pgbench -U postgres -c 10 -j 2 -t 1000 pgbench
```

## Monitoring

### Check Resource Usage

```bash
# Pod resource usage
kubectl top pods -l app=citus

# Node resource usage
kubectl top nodes

# Detailed pod metrics
kubectl describe pod citus-coordinator-0
```

### Check Patroni Status

```bash
# Port forward Patroni API
kubectl port-forward citus-coordinator-0 8008:8008 &

# Check Patroni cluster state
curl http://localhost:8008/cluster | jq

# Check specific node health
curl http://localhost:8008/health | jq
```

## Cleanup

### Remove Test Data

```sql
DROP TABLE IF EXISTS test_vectors;
DROP DATABASE IF EXISTS pgbench;
```

### Remove Cluster (Keep Data)

```bash
kubectl delete postgresql citus-coordinator citus-worker-1 citus-worker-2
```

### Remove Everything

```bash
# Delete clusters
kubectl delete postgresql citus-coordinator citus-worker-1 citus-worker-2

# Delete PVCs
kubectl delete pvc -l app=citus

# Delete operator
helm uninstall postgres-operator -n postgres-operator

# Delete kind cluster (if using kind)
kind delete cluster --name citus-test
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod citus-coordinator-0

# Check pod logs
kubectl logs citus-coordinator-0

# Check operator logs
kubectl logs -n postgres-operator -l app.kubernetes.io/name=postgres-operator
```

### Workers Not Registered

```bash
# Check registrar sidecar logs
kubectl logs citus-worker-1-0 -c citus-worker-registrar

# Manually register (if needed)
kubectl exec -it citus-coordinator-0 -- psql -U postgres
SELECT * FROM citus_add_node('citus-worker-1', 5432);
```

### Performance Issues

```bash
# Check if pods are resource-constrained
kubectl top pods -l app=citus

# Check if storage is slow
kubectl describe pvc -l app=citus

# Check PostgreSQL slow queries
kubectl exec -it citus-coordinator-0 -- psql -U postgres -c \
  "SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"
```

## Automated Testing Script

Create a comprehensive test script:

```bash
cat > test-deployment.sh << 'EOF'
#!/bin/bash
set -e

echo "=== Citus Kubernetes Deployment Test ==="

# Deploy
make deploy

# Wait for ready
kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=300s
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=300s
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=300s

# Get password
export PGPASSWORD=$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do -o jsonpath='{.data.password}' | base64 --decode)

# Port forward
kubectl port-forward svc/citus-coordinator 5432:5432 &
PF_PID=$!
sleep 3

# Test connection
psql -h localhost -U postgres -c "SELECT version();" || exit 1

# Test Citus
psql -h localhost -U postgres -c "SELECT citus_version();" || exit 1

# Test workers
WORKER_COUNT=$(psql -h localhost -U postgres -t -c "SELECT count(*) FROM citus_get_active_worker_nodes();")
if [ "$WORKER_COUNT" -ne 2 ]; then
    echo "ERROR: Expected 2 workers, found $WORKER_COUNT"
    exit 1
fi

# Test distributed table
psql -h localhost -U postgres << SQL
CREATE TABLE test_dist (id int, data text);
SELECT create_distributed_table('test_dist', 'id');
INSERT INTO test_dist VALUES (1, 'test');
SELECT count(*) FROM test_dist;
DROP TABLE test_dist;
SQL

echo "✓ All tests passed!"

# Cleanup
kill $PF_PID
EOF

chmod +x test-deployment.sh
```

Run comprehensive tests:

```bash
./test-deployment.sh
```
