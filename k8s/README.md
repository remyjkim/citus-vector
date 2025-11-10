# Citus + pgvector on Kubernetes with Zalando Postgres Operator

A production-ready Citus cluster with pgvector support for distributed vector similarity search on Kubernetes, managed by the Zalando Postgres Operator.

## Architecture

This setup creates a highly-available Citus cluster on Kubernetes:

- **Coordinator Cluster**: HA PostgreSQL cluster (2 instances via Patroni) serving as the Citus coordinator
- **Worker Clusters**: Multiple HA PostgreSQL clusters (2 instances each) serving as Citus workers
- **Auto-Discovery**: Sidecar containers automatically register workers with the coordinator
- **High Availability**: Each node (coordinator and workers) is a Patroni-managed HA cluster
- **Extensions**: Citus 13.2 + pgvector on PostgreSQL 17 for distributed vector search

### Benefits over Docker Compose

- **High Availability**: Automatic failover for both coordinator and workers
- **Auto-healing**: Failed pods are automatically recreated
- **Scalability**: Easily add more workers by creating new manifests
- **Resource Management**: Kubernetes manages CPU, memory, and storage
- **Production-Ready**: Built on battle-tested Zalando Postgres Operator

## Prerequisites

1. **Kubernetes Cluster** (1.27+)
   - Minikube, kind, GKE, EKS, AKS, or any Kubernetes cluster
   - `kubectl` configured to access your cluster

2. **Zalando Postgres Operator**
   - Install from: https://github.com/zalando/postgres-operator

3. **Docker Registry**
   - Access to a container registry (Docker Hub, GCR, ECR, etc.)
   - Ability to build and push custom images

4. **Storage**
   - A default StorageClass or specify your own in the manifests

## Installation

### Step 1: Install Postgres Operator

```bash
# Add Helm repository
helm repo add postgres-operator-charts https://opensource.zalando.com/postgres-operator/charts/postgres-operator

# Install the operator
helm install postgres-operator postgres-operator-charts/postgres-operator \
  --namespace postgres-operator \
  --create-namespace

# Verify installation
kubectl get pods -n postgres-operator
```

### Step 2: Build and Push Custom Spilo Image

The custom Spilo image includes Citus and pgvector extensions:

```bash
# Navigate to the docker directory
cd k8s/docker

# Build the image (replace with your registry)
docker build -f Dockerfile.spilo-citus-pgvector \
  -t your-registry.io/spilo-citus-pgvector:17-4.0-p3 .

# Push to your registry
docker push your-registry.io/spilo-citus-pgvector:17-4.0-p3
```

### Step 3: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your settings
# Key settings:
# - DOCKER_REGISTRY: Your container registry
# - STORAGE_CLASS: Your Kubernetes storage class
# - Resource allocations
```

### Step 4: Update Manifests with Your Image

Update the `dockerImage` field in all manifests to point to your custom image:

```bash
# Option 1: Manual update
# Edit these files and replace <your-registry> with your actual registry:
# - coordinator/citus-coordinator.yaml
# - workers/citus-worker-1.yaml
# - workers/citus-worker-2.yaml

# Option 2: Use kustomization (edit kustomization.yaml first)
# Update the image reference in kustomization.yaml
```

### Step 5: Deploy the Citus Cluster

```bash
# Deploy using kubectl
kubectl apply -f operator/configmap.yaml
kubectl apply -f coordinator/citus-coordinator.yaml

# Wait for coordinator to be ready (takes 2-3 minutes)
kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=300s

# Deploy workers
kubectl apply -f workers/citus-worker-1.yaml
kubectl apply -f workers/citus-worker-2.yaml

# Wait for workers to be ready
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=300s
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=300s
```

Alternatively, use Kustomize:

```bash
# Deploy everything at once
kubectl apply -k .
```

### Step 6: Verify the Cluster

```bash
# Get coordinator password
export PGPASSWORD=$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
  -o jsonpath='{.data.password}' | base64 --decode)

# Connect to coordinator
kubectl port-forward svc/citus-coordinator 5432:5432 &

# Verify cluster
psql -h localhost -U postgres -c "SELECT * FROM citus_get_active_worker_nodes();"

# Check extensions
psql -h localhost -U postgres -c "SELECT * FROM pg_extension WHERE extname IN ('citus', 'vector');"
```

## Scaling Workers

To add more workers, create additional worker manifests:

```bash
# Copy existing worker manifest
cp workers/citus-worker-2.yaml workers/citus-worker-3.yaml

# Edit the new manifest:
# 1. Change metadata.name to citus-worker-3
# 2. Update worker-id label to "3"
# 3. Update WORKER_HOST env var to "citus-worker-3"
# 4. Update WORKER_ID env var to "3"

# Deploy new worker
kubectl apply -f workers/citus-worker-3.yaml
```

The sidecar container will automatically register the new worker with the coordinator.

## Accessing the Cluster

### From Within Kubernetes

Services are automatically created by the postgres-operator:

- **Coordinator**: `citus-coordinator.default.svc.cluster.local:5432`
- **Worker 1**: `citus-worker-1.default.svc.cluster.local:5432`
- **Worker 2**: `citus-worker-2.default.svc.cluster.local:5432`

Applications in the cluster can connect directly to these services.

### From Outside Kubernetes

#### Option 1: Port Forward (Development)

```bash
kubectl port-forward svc/citus-coordinator 5432:5432
psql -h localhost -U postgres
```

#### Option 2: LoadBalancer Service (Production)

Create a LoadBalancer service for the coordinator:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: citus-coordinator-external
spec:
  type: LoadBalancer
  selector:
    cluster-name: citus-coordinator
    spilo-role: master
  ports:
    - port: 5432
      targetPort: 5432
```

#### Option 3: Ingress with TLS (Production)

Configure an Ingress with PostgreSQL support (requires special Ingress controller).

## Configuration

### Getting Database Credentials

Credentials are automatically generated and stored in Kubernetes secrets:

```bash
# Get coordinator password
kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
  -o jsonpath='{.data.password}' | base64 --decode

# Get worker password (if different)
kubectl get secret postgres.citus-worker-1.credentials.postgresql.acid.zalan.do \
  -o jsonpath='{.data.password}' | base64 --decode
```

### Customizing PostgreSQL Parameters

Edit the `postgresql.parameters` section in the cluster manifests:

```yaml
spec:
  postgresql:
    parameters:
      shared_preload_libraries: "citus,pg_stat_statements"
      max_connections: "200"
      shared_buffers: "4GB"
      # Add more parameters...
```

### Resource Allocation

Edit the `resources` section in the cluster manifests:

```yaml
spec:
  resources:
    requests:
      cpu: "2000m"
      memory: "8Gi"
    limits:
      cpu: "4000m"
      memory: "16Gi"
```

### Storage Configuration

Edit the `volume` section:

```yaml
spec:
  volume:
    size: 50Gi
    storageClass: fast-ssd  # Your storage class
```

## Usage Example

```sql
-- Connect to coordinator
\c postgres

-- Create a distributed table with vector embeddings
CREATE TABLE chunks (
    id bigserial PRIMARY KEY,
    channel_id bigint NOT NULL,
    user_id bigint NOT NULL,
    content text NOT NULL,
    embedding vector(1536) NOT NULL,
    metadata jsonb,
    created_at timestamp DEFAULT now() NOT NULL
);

-- Distribute by channel_id for optimal query routing
SELECT create_distributed_table('chunks', 'channel_id');

-- Create HNSW index for fast similarity search (created on each shard)
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- Additional indexes
CREATE INDEX ON chunks (user_id);
CREATE INDEX ON chunks (created_at);

-- Verify distribution
SELECT * FROM citus_tables;

-- Check shard distribution
SELECT * FROM citus_shards WHERE table_name::text = 'chunks';

-- FAST: Router query (queries one shard only)
SELECT id, content, embedding <=> '[0.1, 0.2, ...]'::vector AS distance
FROM chunks
WHERE channel_id = 1  -- Distribution column filter!
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;
```

## Monitoring

### Check Cluster Status

```bash
# List all PostgreSQL clusters
kubectl get postgresql

# Get detailed status of coordinator
kubectl describe postgresql citus-coordinator

# Check pods
kubectl get pods -l app=citus

# View coordinator logs
kubectl logs -l cluster-name=citus-coordinator,spilo-role=master

# View worker logs
kubectl logs -l cluster-name=citus-worker-1,spilo-role=master
```

### Check Patroni Status

```bash
# Port forward to coordinator
kubectl port-forward svc/citus-coordinator 8008:8008 &

# Check Patroni API
curl http://localhost:8008/patroni
```

## Backup and Restore

### Logical Backups

The postgres-operator supports automatic logical backups:

1. Configure S3/GCS bucket in operator ConfigMap
2. Enable backups in cluster manifest:

```yaml
spec:
  enableLogicalBackup: true
  logicalBackupSchedule: "30 00 * * *"  # Daily at 00:30
```

### Manual Backup

```bash
# Backup coordinator
kubectl exec -it citus-coordinator-0 -- \
  pg_dump -U postgres postgres > coordinator-backup.sql

# Backup worker
kubectl exec -it citus-worker-1-0 -- \
  pg_dump -U postgres postgres > worker-1-backup.sql
```

### WAL Archiving

Configure WAL archiving for point-in-time recovery in the operator ConfigMap:

```yaml
data:
  wal_s3_bucket: "my-backup-bucket"
  wal_gs_bucket: "my-gcs-bucket"
  aws_region: "us-east-1"
```

## Maintenance

### Updating PostgreSQL Version

1. Update the `postgresql.version` in cluster manifests
2. Apply the changes:

```bash
kubectl apply -f coordinator/citus-coordinator.yaml
kubectl apply -f workers/citus-worker-1.yaml
```

The operator will perform a rolling update.

### Scaling Storage

The postgres-operator supports online volume resizing:

```bash
# Edit manifest to increase volume size
# Change: volume.size: 100Gi

kubectl apply -f workers/citus-worker-1.yaml

# Volume will be resized without downtime (if supported by storage class)
```

### Manual Failover

Patroni automatically handles failovers, but you can trigger manual failover:

```bash
# Port forward to Patroni API
kubectl port-forward citus-coordinator-0 8008:8008 &

# Trigger failover
curl -X POST http://localhost:8008/switchover \
  -H "Content-Type: application/json" \
  -d '{"leader": "citus-coordinator-0", "candidate": "citus-coordinator-1"}'
```

## Troubleshooting

### Workers Not Registered

Check the worker registrar sidecar logs:

```bash
kubectl logs -l cluster-name=citus-worker-1 -c citus-worker-registrar
```

Manually register if needed:

```bash
# Connect to coordinator
kubectl exec -it citus-coordinator-0 -- psql -U postgres

# Register worker
SELECT * FROM citus_add_node('citus-worker-1', 5432);
```

### Coordinator Not Ready

Check coordinator logs:

```bash
kubectl logs citus-coordinator-0
```

Check Patroni status:

```bash
kubectl exec citus-coordinator-0 -- patronictl list
```

### Performance Issues

Check resource usage:

```bash
kubectl top pods -l app=citus
```

Adjust resources in manifests and reapply.

### Connection Issues

Verify services:

```bash
kubectl get svc -l app=citus
```

Check pg_hba.conf:

```bash
kubectl exec citus-coordinator-0 -- cat /home/postgres/pgdata/pgroot/data/pg_hba.conf
```

## Cleanup

```bash
# Delete all Citus clusters
kubectl delete postgresql citus-coordinator citus-worker-1 citus-worker-2

# Delete operator configuration
kubectl delete configmap postgres-operator -n postgres-operator

# Uninstall operator (optional)
helm uninstall postgres-operator -n postgres-operator

# Delete PVCs (this deletes all data!)
kubectl delete pvc -l app=citus
```

## Architecture Comparison: Docker Compose vs Kubernetes

| Feature | Docker Compose | Kubernetes |
|---------|---------------|------------|
| **High Availability** | Single instance per role | 2+ instances per role (Patroni) |
| **Automatic Failover** | No | Yes (Patroni) |
| **Auto-healing** | Manual restart | Automatic |
| **Scaling** | `docker-compose scale` | Create new manifests |
| **Resource Limits** | Manual config | Kubernetes enforcement |
| **Load Balancing** | External | Built-in services |
| **Storage** | Docker volumes | PersistentVolumeClaims |
| **Monitoring** | External tools | Native K8s + Prometheus |
| **Backup** | Manual | Automated via operator |

## Performance Tips

1. **Use distribution column filters**: Always filter by `channel_id` for fast router queries
2. **Choose appropriate storage class**: Use SSD-backed storage (gp3, pd-ssd)
3. **Tune resources**: Workers need more CPU/memory than coordinator
4. **Enable connection pooling**: Use PgBouncer for high-concurrency workloads
5. **Configure HNSW properly**: Set `hnsw.ef_search` based on recall needs
6. **Monitor shard distribution**: Ensure even distribution across workers

## Files

- `docker/Dockerfile.spilo-citus-pgvector`: Custom Spilo image with Citus + pgvector
- `docker/*.sql`: Extension initialization scripts
- `operator/namespace.yaml`: Postgres operator namespace
- `operator/configmap.yaml`: Postgres operator configuration
- `coordinator/citus-coordinator.yaml`: Coordinator cluster manifest
- `workers/citus-worker-*.yaml`: Worker cluster manifests
- `kustomization.yaml`: Kustomize configuration for easy deployment
- `.env.example`: Environment configuration template

## References

- [Zalando Postgres Operator](https://github.com/zalando/postgres-operator)
- [Postgres Operator Documentation](https://postgres-operator.readthedocs.io/)
- [Citus Documentation](https://docs.citusdata.com/)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [Patroni Documentation](https://patroni.readthedocs.io/)

## License

This configuration is provided as-is for use with open-source projects. Refer to individual component licenses:
- Zalando Postgres Operator: MIT License
- Citus: AGPLv3 / Commercial
- pgvector: PostgreSQL License
