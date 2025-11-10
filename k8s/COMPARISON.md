# Docker Compose vs Kubernetes Implementation Comparison

This document compares the docker-compose and Kubernetes implementations of Citus + pgvector.

## Architecture Comparison

### Docker Compose (./compose/)

```
┌─────────────────────────────────────────────────────┐
│  Docker Host                                         │
│                                                       │
│  ┌──────────────┐                                   │
│  │   Manager    │ (Membership Manager)              │
│  │ Auto-discovery│                                   │
│  └──────┬───────┘                                   │
│         │                                             │
│    ┌────▼─────────────────────┐                     │
│    │                           │                     │
│  ┌─▼────────┐  ┌─────────┐  ┌─▼───────┐           │
│  │  Master  │  │ Worker  │  │ Worker  │           │
│  │(Coord.)  │  │    1    │  │    2    │           │
│  │  Single  │  │ Single  │  │ Single  │           │
│  │ Instance │  │Instance │  │Instance │           │
│  └──────────┘  └─────────┘  └─────────┘           │
│                                                       │
│  No HA, manual scaling, Docker volumes              │
└─────────────────────────────────────────────────────┘
```

### Kubernetes (./k8s/)

```
┌─────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │     Coordinator (Patroni HA Cluster)                │   │
│  │  ┌──────────────────┐    ┌──────────────────┐      │   │
│  │  │   Coordinator    │◄──►│   Coordinator    │      │   │
│  │  │   Primary        │    │   Replica        │      │   │
│  │  │  (auto-failover) │    │  (auto-failover) │      │   │
│  │  └──────────────────┘    └──────────────────┘      │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                               │
│                              │ Distributed queries           │
│           ┌──────────────────┴──────────────────┐          │
│           │                                       │          │
│  ┌────────▼──────────────┐         ┌────────────▼───────┐ │
│  │  Worker 1 (HA Cluster)│         │ Worker 2 (HA Cluster)│ │
│  │  ┌────────┐┌────────┐ │         │ ┌────────┐┌────────┐│ │
│  │  │Primary ││Replica │ │         │ │Primary ││Replica ││ │
│  │  │(active)││(standby)│ │        │ │(active)││(standby)││ │
│  │  └────────┘└────────┘ │         │ └────────┘└────────┘│ │
│  └───────────────────────┘         └─────────────────────┘ │
│                                                               │
│  Full HA, automatic healing, persistent volumes, managed    │
└─────────────────────────────────────────────────────────────┘
```

## Feature Matrix

| Feature | Docker Compose | Kubernetes |
|---------|---------------|------------|
| **High Availability** | ❌ No | ✅ Yes (Patroni) |
| **Automatic Failover** | ❌ No | ✅ Yes |
| **Auto-healing** | ❌ Manual restart | ✅ Automatic |
| **Scaling** | Manual (`docker-compose scale`) | Manual (add manifests) |
| **Load Balancing** | External | ✅ Built-in Services |
| **Health Checks** | Custom script + volume | ✅ Native liveness/readiness |
| **Resource Limits** | Docker config | ✅ Kubernetes enforcement |
| **Storage** | Docker volumes | PersistentVolumeClaims |
| **Networking** | Docker network | Kubernetes Services |
| **Service Discovery** | Custom manager | ✅ DNS (ServiceName.namespace) |
| **Backup** | Manual | ✅ Operator-managed |
| **Monitoring** | External | ✅ Native + Prometheus |
| **Rolling Updates** | Manual | ✅ Operator-managed |
| **Node Affinity** | ❌ No | ✅ Yes (pod/node selectors) |
| **Secrets Management** | ENV vars / files | ✅ Kubernetes Secrets |
| **Best for** | Development / Testing | Production / Scale |

## Component Mapping

| Docker Compose | Kubernetes | Notes |
|----------------|------------|-------|
| `master` service | `citus-coordinator` PostgreSQL cluster | Now HA with 2 instances |
| `worker` service | `citus-worker-N` PostgreSQL clusters | Each worker is now HA with 2 instances |
| `manager` service | Sidecar containers | Worker registration via sidecars |
| `healthcheck-volume` | Kubernetes health probes | Native liveness/readiness probes |
| `wait-for-manager.sh` | Init containers + sidecars | Kubernetes-native ordering |
| Docker network | Kubernetes Services | DNS-based service discovery |
| Docker volumes | PersistentVolumeClaims | Persistent, auto-provisioned storage |
| ENV vars | ConfigMaps + Secrets | Secure configuration management |

## File Structure Comparison

### Docker Compose

```
compose/
├── docker-compose.yml          # Main orchestration
├── Dockerfile.citus-pgvector   # Custom image
├── 001-create-citus-extension.sql
├── 002-create-pgvector-extension.sql
├── wait-for-manager.sh         # Coordination script
├── pg_healthcheck              # Health check
└── README.md                   # Documentation
```

### Kubernetes

```
k8s/
├── docker/
│   ├── Dockerfile.spilo-citus-pgvector  # Custom Spilo image
│   ├── 001-create-citus-extension.sql
│   └── 002-create-pgvector-extension.sql
├── operator/
│   ├── namespace.yaml          # Operator namespace
│   └── configmap.yaml          # Operator config
├── coordinator/
│   └── citus-coordinator.yaml  # Coordinator cluster
├── workers/
│   ├── citus-worker-1.yaml     # Worker 1 cluster
│   └── citus-worker-2.yaml     # Worker 2 cluster
├── kustomization.yaml          # Kustomize config
├── Makefile                    # Helper commands
├── .env.example                # Configuration template
├── README.md                   # Full documentation
├── QUICKSTART.md               # Quick start guide
└── COMPARISON.md               # This file
```

## Configuration Comparison

### Starting the Cluster

**Docker Compose:**
```bash
cd compose
cp .env.example .env
# Edit .env
docker-compose up -d --build
```

**Kubernetes:**
```bash
cd k8s
cp .env.example .env
# Edit .env
make full-install
```

### Scaling Workers

**Docker Compose:**
```bash
docker-compose up -d --scale worker=5
# Manager automatically registers new workers
```

**Kubernetes:**
```bash
# Copy and edit worker manifest
cp workers/citus-worker-2.yaml workers/citus-worker-3.yaml
# Edit manifest (name, labels, env vars)
kubectl apply -f workers/citus-worker-3.yaml
# Sidecar automatically registers new worker
```

### Accessing the Database

**Docker Compose:**
```bash
# Direct access (coordinator exposed on host)
psql -h localhost -p 5432 -U postgres

# Or exec into container
docker exec -it citus_master psql -U postgres
```

**Kubernetes:**
```bash
# Port forward (development)
kubectl port-forward svc/citus-coordinator 5432:5432
psql -h localhost -U postgres

# LoadBalancer (production)
# Create LoadBalancer service, get external IP
psql -h <external-ip> -U postgres

# Or exec into pod
kubectl exec -it citus-coordinator-0 -- psql -U postgres
```

### Viewing Logs

**Docker Compose:**
```bash
docker-compose logs master
docker-compose logs worker
docker-compose logs -f  # Follow all
```

**Kubernetes:**
```bash
kubectl logs -l cluster-name=citus-coordinator
kubectl logs -l cluster-name=citus-worker-1
kubectl logs -f citus-coordinator-0  # Follow
```

### Getting Credentials

**Docker Compose:**
```bash
# Set in .env file
echo $POSTGRES_PASSWORD
```

**Kubernetes:**
```bash
# Auto-generated by operator
kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
  -o jsonpath='{.data.password}' | base64 --decode
```

### Backups

**Docker Compose:**
```bash
# Manual backup
docker exec citus_master pg_dump -U postgres postgres > backup.sql

# Manual restore
cat backup.sql | docker exec -i citus_master psql -U postgres
```

**Kubernetes:**
```bash
# Automated logical backups (configure in operator)
# Or manual:
kubectl exec citus-coordinator-0 -- pg_dump -U postgres postgres > backup.sql
cat backup.sql | kubectl exec -i citus-coordinator-0 -- psql -U postgres

# WAL archiving to S3/GCS (configure in operator)
```

## Performance Considerations

### Docker Compose

- **Pros:**
  - Lower overhead (no Kubernetes networking)
  - Simpler for single-node setups
  - Faster startup time

- **Cons:**
  - No automatic recovery from node failures
  - Manual intervention required for scaling
  - Limited resource isolation

### Kubernetes

- **Pros:**
  - Automatic failover and recovery
  - Better resource utilization across cluster
  - Production-grade monitoring and observability
  - Multi-node distribution for true HA

- **Cons:**
  - Additional networking overhead (Services, DNS)
  - More complex initial setup
  - Requires Kubernetes cluster

## When to Use Each

### Use Docker Compose When:

- ✅ Local development and testing
- ✅ Single-developer environments
- ✅ Learning Citus and pgvector
- ✅ Quick prototyping
- ✅ CI/CD testing environments
- ✅ Resource-constrained environments
- ✅ Simple deployment requirements

### Use Kubernetes When:

- ✅ Production deployments
- ✅ High availability required
- ✅ Multi-node clusters
- ✅ Need automatic failover
- ✅ Large-scale data workloads
- ✅ Existing Kubernetes infrastructure
- ✅ Team familiar with Kubernetes
- ✅ Need advanced features (backup automation, monitoring, etc.)

## Migration Path

### From Docker Compose to Kubernetes

1. **Test locally**: Use kind or minikube to test K8s setup
2. **Build custom image**: Build and push Spilo image to your registry
3. **Start small**: Deploy with same number of workers as Docker Compose
4. **Migrate data**: Use `pg_dump` / `pg_restore` or logical replication
5. **Update application**: Point to new K8s service endpoints
6. **Scale**: Add more workers as needed
7. **Enable HA**: Configure replicas, backups, monitoring

### Sample Migration Script

```bash
# 1. Backup from Docker Compose
docker exec citus_master pg_dump -U postgres postgres > data.sql

# 2. Deploy K8s cluster
cd ../k8s
make full-install

# 3. Wait for cluster ready
make status

# 4. Restore to K8s
kubectl port-forward svc/citus-coordinator 5432:5432 &
export PGPASSWORD=$(make get-password)
psql -h localhost -U postgres < data.sql

# 5. Verify
psql -h localhost -U postgres -c "SELECT * FROM citus_get_active_worker_nodes();"

# 6. Update application connection strings
# From: host.docker.internal:5432 or localhost:5432
# To: citus-coordinator.default.svc.cluster.local:5432

# 7. Shutdown Docker Compose
cd ../compose
docker-compose down
```

## Cost Comparison

### Docker Compose
- **Infrastructure**: Single VM/server
- **Storage**: Local disk or attached volumes
- **Backup**: Manual or cron jobs
- **Monitoring**: Manual setup
- **Total**: Lower upfront cost, higher operational cost

### Kubernetes
- **Infrastructure**: Kubernetes cluster (managed or self-hosted)
- **Storage**: Cloud persistent disks (auto-provisioned)
- **Backup**: Operator-managed (included)
- **Monitoring**: Native integration (Prometheus, etc.)
- **Total**: Higher upfront cost, lower operational cost at scale

## Support and Maintenance

| Aspect | Docker Compose | Kubernetes |
|--------|---------------|------------|
| **Updates** | Manual image rebuilds | Operator-managed rolling updates |
| **Monitoring** | DIY | Native + operator integration |
| **Alerting** | DIY | Kubernetes events + Prometheus |
| **Security** | Manual | RBAC, Network Policies, Pod Security |
| **Compliance** | Manual | Policy enforcement frameworks |
| **Documentation** | This README | Extensive operator docs + community |

## Conclusion

Both implementations provide a fully functional Citus cluster with pgvector support. Choose based on your:

- **Environment**: Development vs Production
- **Scale**: Small vs Large
- **Team**: Familiarity with Kubernetes
- **Requirements**: HA, auto-scaling, monitoring needs
- **Budget**: Infrastructure and operational costs

For most **production workloads**, the Kubernetes implementation provides better reliability, scalability, and operational efficiency despite higher initial complexity.

For **development and testing**, Docker Compose offers simplicity and speed.

**Best Practice**: Use Docker Compose for development, Kubernetes for production, maintaining configuration parity where possible.
