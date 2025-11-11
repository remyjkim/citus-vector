# Quick Start Guide: Citus + pgvector on Kubernetes

Get your Citus cluster with pgvector running on Kubernetes in under 15 minutes.

## Prerequisites

- Kubernetes cluster (Minikube, kind, GKE, EKS, AKS)
- `kubectl` configured
- `helm` installed
- Docker and access to a container registry

## Quick Installation

### 1. Configure Environment

```bash
cd k8s
cp .env.example .env
# Edit .env with your registry and preferences
```

Minimal configuration:
```bash
DOCKER_REGISTRY=your-dockerhub-username
IMAGE_NAME=spilo-citus-pgvector
IMAGE_TAG=17-4.0-p3
```

### 2. Install Everything

Using the Makefile:

```bash
# Complete installation (installs operator, builds image, deploys cluster)
make full-install
```

Or step-by-step:

```bash
# Install operator
make install-operator

# Build and push custom image
make build-push

# Update manifests with your image
make update-manifests

# Deploy cluster
make deploy
```

### 3. Verify Installation

```bash
# Check status
make status

# Get coordinator password
make get-password

# Verify Citus cluster
make verify
```

### 4. Connect

```bash
# Port-forward and get connection info
make connect

# In another terminal:
psql -h localhost -U postgres
```

## What Gets Deployed

- **1 Coordinator Cluster**: 2 PostgreSQL instances (primary + replica)
- **2 Worker Clusters**: 2 PostgreSQL instances each (primary + replica per worker)
- **Total**: 6 PostgreSQL pods providing high availability

## Testing Your Cluster

Once connected to the coordinator:

```sql
-- Verify extensions
SELECT * FROM pg_extension WHERE extname IN ('citus', 'vector');

-- Check workers
SELECT * FROM citus_get_active_worker_nodes();

-- Create a distributed table with vectors
CREATE TABLE items (
    id bigserial PRIMARY KEY,
    tenant_id bigint NOT NULL,
    embedding vector(1536) NOT NULL,
    metadata jsonb
);

-- Distribute it
SELECT create_distributed_table('items', 'tenant_id');

-- Create vector index
CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops);

-- Insert test data
INSERT INTO items (tenant_id, embedding, metadata)
VALUES (1, array_fill(0.1, ARRAY[1536])::vector, '{"test": true}');

-- Query
SELECT * FROM items WHERE tenant_id = 1
ORDER BY embedding <=> array_fill(0.1, ARRAY[1536])::vector
LIMIT 10;
```

## Common Commands

```bash
# Show cluster status
make status

# View logs
make logs-coordinator
make logs-worker1

# Get password
make get-password

# Connect to database
make connect

# Restart coordinator
make restart-coordinator

# Delete cluster (keeps data)
make clean

# Delete everything including data
make clean-all
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Kubernetes Cluster                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Citus Coordinator (HA Cluster)            │   │
│  │  ┌──────────────────┐    ┌──────────────────┐      │   │
│  │  │   Coordinator    │◄──►│   Coordinator    │      │   │
│  │  │   Primary        │    │   Replica        │      │   │
│  │  └──────────────────┘    └──────────────────┘      │   │
│  │         (Patroni managed with auto-failover)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                               │
│                              │ Citus metadata                │
│           ┌──────────────────┴──────────────────┐          │
│           │                                       │          │
│  ┌────────▼──────────────┐         ┌────────────▼───────┐ │
│  │  Worker 1 (HA Cluster)│         │ Worker 2 (HA Cluster)│ │
│  │  ┌────────┐┌────────┐ │         │ ┌────────┐┌────────┐│ │
│  │  │Primary ││Replica │ │         │ │Primary ││Replica ││ │
│  │  └────────┘└────────┘ │         │ └────────┘└────────┘│ │
│  │    (Data shards)      │         │   (Data shards)     │ │
│  └───────────────────────┘         └─────────────────────┘ │
│                                                               │
│  Each cluster managed by Patroni for automatic failover     │
└─────────────────────────────────────────────────────────────┘
```

## Performance Tips

1. **Use distribution column**: Always filter by `tenant_id` or your distribution column
2. **SSD storage**: Use fast storage classes (gp3, pd-ssd)
3. **Resource tuning**: Adjust CPU/memory in manifests based on workload
4. **Connection pooling**: Enable PgBouncer for high-concurrency (see README.md)

## Next Steps

- Read the full [README.md](README.md) for detailed configuration
- Configure backup and monitoring
- Set up external access (LoadBalancer or Ingress)
- Tune PostgreSQL parameters for your workload
- Add more workers by creating additional manifests

## Troubleshooting

**Workers not showing up?**
```bash
# Check worker registrar logs
kubectl logs -l cluster-name=citus-worker-1 -c citus-worker-registrar
```

**Can't connect?**
```bash
# Verify services exist
kubectl get svc -l app=citus

# Check pod status
kubectl get pods -l app=citus
```

**Need help?**
- See [README.md](README.md) Troubleshooting section
- Check [Postgres Operator docs](https://postgres-operator.readthedocs.io/)
- Review [Citus documentation](https://docs.citusdata.com/)

## Clean Up

```bash
# Remove cluster but keep operator
make clean

# Remove everything
make clean-all
make uninstall-operator
```
