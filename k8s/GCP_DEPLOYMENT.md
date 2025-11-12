# Deploying Citus + pgvector to Google Cloud Platform (GKE)

This guide walks you through deploying the Citus cluster to Google Kubernetes Engine (GKE).

## Prerequisites

1. **GCP Account** with billing enabled
2. **gcloud CLI** installed and configured
3. **kubectl** installed
4. **docker** installed
5. **helm** installed

## Step 1: Set Up GCP Project

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export ZONE="us-central1-a"
export CLUSTER_NAME="citus-cluster"

# Authenticate with GCP
gcloud auth login

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable container.googleapis.com
gcloud services enable compute.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

## Step 2: Create GKE Cluster

### Option A: Standard GKE Cluster (Recommended for Production)

```bash
# Create a GKE cluster with 3 nodes
gcloud container clusters create $CLUSTER_NAME \
    --region=$REGION \
    --num-nodes=1 \
    --node-locations=$ZONE \
    --machine-type=n2-standard-4 \
    --disk-size=100 \
    --disk-type=pd-ssd \
    --enable-autorepair \
    --enable-autoupgrade \
    --enable-autoscaling \
    --min-nodes=1 \
    --max-nodes=5 \
    --enable-stackdriver-kubernetes \
    --addons=HorizontalPodAutoscaling,HttpLoadBalancing,GcePersistentDiskCsiDriver

# Get cluster credentials
gcloud container clusters get-credentials $CLUSTER_NAME --region=$REGION

# Verify connection
kubectl cluster-info
```

### Option B: Autopilot GKE (Simpler, Fully Managed)

```bash
# Create an Autopilot cluster (fully managed)
gcloud container clusters create-auto $CLUSTER_NAME \
    --region=$REGION \
    --release-channel=regular

# Get credentials
gcloud container clusters get-credentials $CLUSTER_NAME --region=$REGION

# Verify connection
kubectl cluster-info
```

**Recommended**: Use Standard cluster for production to have more control over node types and resources.

## Step 3: Set Up Google Artifact Registry

```bash
# Create Artifact Registry repository for Docker images
gcloud artifacts repositories create citus-images \
    --repository-format=docker \
    --location=$REGION \
    --description="Citus PostgreSQL images"

# Configure Docker to use Artifact Registry
gcloud auth configure-docker ${REGION}-docker.pkg.dev
```

## Step 4: Build and Push Custom Spilo Image

```bash
cd k8s

# Set registry URL
export REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/citus-images"
export IMAGE_NAME="spilo-citus-pgvector"
export IMAGE_TAG="17-4.0-p3"
export IMAGE_FULL="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"

# Build the image
cd docker
docker build -f Dockerfile.spilo-citus-pgvector -t $IMAGE_FULL .

# Push to Artifact Registry
docker push $IMAGE_FULL

echo "✓ Image pushed to: $IMAGE_FULL"

cd ..
```

## Step 5: Configure Deployment for GCP

Create a GCP-specific environment file:

```bash
cat > .env.gcp << EOF
# GCP Configuration
PROJECT_ID=${PROJECT_ID}
REGION=${REGION}
CLUSTER_NAME=${CLUSTER_NAME}

# Docker Registry (Artifact Registry)
DOCKER_REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/citus-images
IMAGE_NAME=spilo-citus-pgvector
IMAGE_TAG=17-4.0-p3

# Kubernetes Namespace
NAMESPACE=default

# PostgreSQL Configuration
POSTGRES_USER=postgres

# Storage Configuration (GCP)
STORAGE_CLASS=standard-rwo  # GKE default storage class
COORDINATOR_STORAGE_SIZE=10Gi
WORKER_STORAGE_SIZE=50Gi

# Resource Configuration
COORDINATOR_CPU_REQUEST=1000m
COORDINATOR_CPU_LIMIT=2000m
COORDINATOR_MEMORY_REQUEST=4Gi
COORDINATOR_MEMORY_LIMIT=8Gi

WORKER_CPU_REQUEST=2000m
WORKER_CPU_LIMIT=4000m
WORKER_MEMORY_REQUEST=8Gi
WORKER_MEMORY_LIMIT=16Gi

# Network Configuration
ALLOW_SOURCE_RANGES=0.0.0.0/0  # Restrict this in production!
EOF

# Use GCP config
cp .env.gcp .env
```

## Step 6: Update Manifests for GCP

Create GCP-specific kustomization:

```bash
cat > kustomization-gcp.yaml << EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: default

resources:
  - operator/configmap.yaml
  - coordinator/citus-coordinator.yaml
  - workers/citus-worker.yaml
  - workers/citus-worker-2.yaml

patches:
  # Update docker image for all PostgreSQL clusters
  - target:
      kind: postgresql
      group: acid.zalan.do
      version: v1
    patch: |-
      - op: replace
        path: /spec/dockerImage
        value: ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}
      - op: replace
        path: /spec/volume/storageClass
        value: standard-rwo

commonLabels:
  app.kubernetes.io/name: citus-vector
  app.kubernetes.io/component: database
  app.kubernetes.io/managed-by: postgres-operator
  app.kubernetes.io/platform: gcp
EOF
```

Or update manifests directly:

```bash
# Update coordinator manifest
sed -i.bak "s|<your-registry>/spilo-citus-pgvector:17-4.0-p3|${IMAGE_FULL}|g" coordinator/citus-coordinator.yaml
sed -i.bak "s|storageClass: standard|storageClass: standard-rwo|g" coordinator/citus-coordinator.yaml

# Update worker manifests
sed -i.bak "s|<your-registry>/spilo-citus-pgvector:17-4.0-p3|${IMAGE_FULL}|g" workers/*.yaml
sed -i.bak "s|storageClass: standard|storageClass: standard-rwo|g" workers/*.yaml

# Remove backup files
rm -f coordinator/*.bak workers/*.bak
```

## Step 7: Install Postgres Operator

```bash
# Add Helm repository
helm repo add postgres-operator-charts https://opensource.zalando.com/postgres-operator/charts/postgres-operator
helm repo update

# Install operator
helm install postgres-operator postgres-operator-charts/postgres-operator \
    --namespace postgres-operator \
    --create-namespace \
    --wait

# Verify installation
kubectl get pods -n postgres-operator

# Expected output: postgres-operator pod in Running state
```

## Step 8: Deploy Citus Cluster

```bash
# Deploy operator config
kubectl apply -f operator/configmap.yaml

# Deploy coordinator
kubectl apply -f coordinator/citus-coordinator.yaml

# Wait for coordinator to be ready (takes 3-5 minutes)
echo "Waiting for coordinator to be ready..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=600s

# Check coordinator status
kubectl get postgresql citus-coordinator
kubectl get pods -l cluster-name=citus-coordinator

# Deploy workers
kubectl apply -f workers/citus-worker.yaml
kubectl apply -f workers/citus-worker-2.yaml

# Wait for workers to be ready
echo "Waiting for workers to be ready..."
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=600s
kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=600s

echo "✓ Citus cluster deployed successfully!"
```

## Step 9: Verify Deployment

```bash
# Check all PostgreSQL clusters
kubectl get postgresql

# Check all pods
kubectl get pods -l app=citus

# Check services
kubectl get svc -l app=citus

# Check persistent volumes
kubectl get pvc -l app=citus

# Get coordinator password
export PGPASSWORD=$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
    -o jsonpath='{.data.password}' | base64 --decode)

echo "Coordinator password: $PGPASSWORD"
```

## Step 10: Connect to the Cluster

### Option A: Port Forward (Development/Testing)

```bash
# Port forward to coordinator
kubectl port-forward svc/citus-coordinator 5432:5432 &

# Connect with psql
psql -h localhost -U postgres

# Verify Citus cluster
SELECT * FROM citus_get_active_worker_nodes();
SELECT version();
SELECT citus_version();
```

### Option B: Cloud SQL Proxy (Not applicable for this setup)

### Option C: Internal Load Balancer (Production)

Create an internal load balancer for secure access within GCP:

```bash
cat > coordinator-internal-lb.yaml << 'EOF'
apiVersion: v1
kind: Service
metadata:
  name: citus-coordinator-internal
  annotations:
    cloud.google.com/load-balancer-type: "Internal"
    networking.gke.io/internal-load-balancer-allow-global-access: "true"
spec:
  type: LoadBalancer
  selector:
    cluster-name: citus-coordinator
    spilo-role: master
  ports:
    - port: 5432
      targetPort: 5432
      protocol: TCP
EOF

kubectl apply -f coordinator-internal-lb.yaml

# Get internal IP
kubectl get svc citus-coordinator-internal

# Connect from GCP VM or Cloud Shell
psql -h <INTERNAL-IP> -U postgres
```

### Option D: External Load Balancer (Use with Caution!)

```bash
cat > coordinator-external-lb.yaml << 'EOF'
apiVersion: v1
kind: Service
metadata:
  name: citus-coordinator-external
  annotations:
    cloud.google.com/load-balancer-type: "External"
spec:
  type: LoadBalancer
  selector:
    cluster-name: citus-coordinator
    spilo-role: master
  ports:
    - port: 5432
      targetPort: 5432
      protocol: TCP
  # Restrict source IPs for security
  loadBalancerSourceRanges:
    - "YOUR_IP/32"  # Replace with your IP
EOF

kubectl apply -f coordinator-external-lb.yaml

# Get external IP (takes 1-2 minutes)
kubectl get svc citus-coordinator-external -w

# Connect from anywhere (with allowed IP)
psql -h <EXTERNAL-IP> -U postgres
```

## Step 11: Set Up Backups (Optional but Recommended)

### Configure WAL Archiving to Google Cloud Storage

```bash
# Create GCS bucket for backups
export BACKUP_BUCKET="${PROJECT_ID}-citus-backups"
gsutil mb -l $REGION gs://$BACKUP_BUCKET

# Grant GKE service account access
export GKE_SA=$(gcloud iam service-accounts list \
    --filter="displayName:Compute Engine default service account" \
    --format="value(email)")

gsutil iam ch serviceAccount:${GKE_SA}:roles/storage.objectAdmin gs://$BACKUP_BUCKET

# Update operator ConfigMap to enable backups
kubectl patch configmap postgres-operator -n postgres-operator --type merge -p "
data:
  wal_gs_bucket: ${BACKUP_BUCKET}
"

# Restart operator to pick up changes
kubectl rollout restart deployment postgres-operator -n postgres-operator
```

### Enable Logical Backups

Update your coordinator manifest to enable backups:

```yaml
spec:
  enableLogicalBackup: true
  logicalBackupSchedule: "30 00 * * *"  # Daily at 00:30 UTC
```

Apply the change:

```bash
kubectl apply -f coordinator/citus-coordinator.yaml
```

## Step 12: Set Up Monitoring (Optional)

### Install Prometheus and Grafana

```bash
# Add Prometheus Helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install Prometheus and Grafana
helm install monitoring prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --create-namespace \
    --wait

# Port forward to Grafana
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80 &

# Get Grafana admin password
kubectl get secret -n monitoring monitoring-grafana -o jsonpath='{.data.admin-password}' | base64 --decode

# Access Grafana at http://localhost:3000
# Username: admin
# Password: (from above command)
```

## Cost Optimization Tips

### 1. Use Preemptible/Spot Nodes for Development

```bash
# Create node pool with spot VMs (much cheaper)
gcloud container node-pools create spot-pool \
    --cluster=$CLUSTER_NAME \
    --region=$REGION \
    --spot \
    --machine-type=n2-standard-4 \
    --num-nodes=1 \
    --enable-autoscaling \
    --min-nodes=1 \
    --max-nodes=3

# Label spot nodes
kubectl label nodes -l cloud.google.com/gke-spot=true workload-type=spot
```

### 2. Use Standard Storage for Non-Critical Data

Update worker storage class to use standard (HDD) instead of SSD:

```yaml
spec:
  volume:
    size: 50Gi
    storageClass: standard-rwo  # Standard persistent disk (cheaper)
```

### 3. Auto-Scaling

The cluster already has autoscaling enabled. Monitor and adjust:

```bash
# Check current node count
kubectl get nodes

# Adjust autoscaling if needed
gcloud container clusters update $CLUSTER_NAME \
    --region=$REGION \
    --enable-autoscaling \
    --min-nodes=1 \
    --max-nodes=5
```

### 4. Right-Size Resources

Monitor actual resource usage:

```bash
# Install metrics-server if not present
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Check resource usage
kubectl top nodes
kubectl top pods -l app=citus
```

## Estimated Costs (US Region)

**GKE Cluster (3 x n2-standard-4 nodes):**
- Compute: ~$150-250/month
- Storage (SSD): ~$0.17/GB/month
- LoadBalancer: ~$20/month
- **Total: ~$200-300/month**

**Cost Savings:**
- Use Autopilot: Reduce management overhead
- Use Spot VMs: Save up to 60-90% on compute
- Use Standard Storage: Save 50% on storage costs
- Scale down during off-hours: Save 30-50%

## Troubleshooting

### Pods Stuck in Pending

```bash
# Check events
kubectl describe pod <pod-name>

# Common issues:
# 1. Insufficient resources
kubectl top nodes

# 2. Storage class not available
kubectl get storageclasses

# 3. Image pull errors
kubectl describe pod <pod-name> | grep -A 10 Events
```

### Image Pull Errors

```bash
# Verify Artifact Registry permissions
gcloud artifacts repositories get-iam-policy citus-images --location=$REGION

# Grant GKE service account pull access
gcloud artifacts repositories add-iam-policy-binding citus-images \
    --location=$REGION \
    --member=serviceAccount:${GKE_SA} \
    --role=roles/artifactregistry.reader
```

### Workers Not Registering

```bash
# Check worker registrar logs
kubectl logs -l cluster-name=citus-worker-1 -c citus-worker-registrar

# Manually register if needed
kubectl port-forward svc/citus-coordinator 5432:5432 &
psql -h localhost -U postgres
SELECT * FROM citus_add_node('citus-worker-1', 5432);
SELECT * FROM citus_add_node('citus-worker-2', 5432);
```

### Network Issues

```bash
# Check GKE firewall rules
gcloud compute firewall-rules list --filter="network:default"

# Verify pod networking
kubectl run test-pod --rm -it --image=postgres:17 -- bash
# Inside pod:
psql -h citus-coordinator -U postgres
```

## Cleanup

### Delete Cluster Resources

```bash
# Delete PostgreSQL clusters (keeps PVCs)
kubectl delete postgresql citus-coordinator citus-worker-1 citus-worker-2

# Delete PVCs (DELETES ALL DATA!)
kubectl delete pvc -l app=citus

# Uninstall operator
helm uninstall postgres-operator -n postgres-operator
kubectl delete namespace postgres-operator

# Delete monitoring (if installed)
helm uninstall monitoring -n monitoring
kubectl delete namespace monitoring
```

### Delete GKE Cluster

```bash
# Delete the cluster
gcloud container clusters delete $CLUSTER_NAME --region=$REGION --quiet

# Delete Artifact Registry repository
gcloud artifacts repositories delete citus-images --location=$REGION --quiet

# Delete GCS backup bucket
gsutil -m rm -r gs://$BACKUP_BUCKET

# Delete load balancer forwarding rules (if any remain)
gcloud compute forwarding-rules list --filter="description~citus" --format="value(name)" | \
    xargs -I {} gcloud compute forwarding-rules delete {} --region=$REGION --quiet
```

## Production Checklist

- [ ] Enable WAL archiving to GCS
- [ ] Set up logical backups
- [ ] Configure internal load balancer (not external!)
- [ ] Restrict network access with firewall rules
- [ ] Enable GKE audit logging
- [ ] Set up monitoring and alerting
- [ ] Configure resource quotas
- [ ] Enable auto-scaling
- [ ] Set up disaster recovery procedures
- [ ] Document backup/restore procedures
- [ ] Test failover scenarios
- [ ] Set up cost monitoring and budgets

## Next Steps

1. **Test the deployment**: Run queries and verify functionality
2. **Load your data**: Migrate data from existing sources
3. **Set up monitoring**: Configure Prometheus/Grafana dashboards
4. **Optimize costs**: Right-size resources based on actual usage
5. **Security hardening**: Implement network policies and RBAC
6. **Disaster recovery**: Test backup and restore procedures

## Support

- [GKE Documentation](https://cloud.google.com/kubernetes-engine/docs)
- [Postgres Operator Documentation](https://postgres-operator.readthedocs.io/)
- [Citus Documentation](https://docs.citusdata.com/)
- [GCP Support](https://cloud.google.com/support)

## Useful Commands

```bash
# View cluster info
gcloud container clusters describe $CLUSTER_NAME --region=$REGION

# Get cluster credentials
gcloud container clusters get-credentials $CLUSTER_NAME --region=$REGION

# SSH to a node
gcloud compute ssh $(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')

# View GKE logs
gcloud logging read "resource.type=k8s_cluster" --limit=50

# Monitor costs
gcloud beta billing budgets list
```
