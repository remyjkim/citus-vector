# Makefile for Citus + pgvector on Kubernetes
# Requires: kubectl, docker, helm

# Load environment variables
include .env
export

# Image configuration
IMAGE_FULL=$(DOCKER_REGISTRY)/$(IMAGE_NAME):$(IMAGE_TAG)

.PHONY: help
help: ## Show this help message
	@echo "Citus + pgvector on Kubernetes - Makefile Commands"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: check-env
check-env: ## Check if environment is configured
	@echo "Checking environment configuration..."
	@test -f .env || (echo "ERROR: .env file not found. Copy .env.example to .env and configure." && exit 1)
	@echo "✓ Environment configured"
	@echo "  Registry: $(DOCKER_REGISTRY)"
	@echo "  Image: $(IMAGE_NAME):$(IMAGE_TAG)"

.PHONY: install-operator
install-operator: ## Install Zalando Postgres Operator
	@echo "Installing Postgres Operator..."
	helm repo add postgres-operator-charts https://opensource.zalando.com/postgres-operator/charts/postgres-operator || true
	helm repo update
	helm upgrade --install postgres-operator postgres-operator-charts/postgres-operator \
		--namespace postgres-operator \
		--create-namespace \
		--wait
	@echo "✓ Postgres Operator installed"

.PHONY: build-image
build-image: check-env ## Build custom Spilo image
	@echo "Building custom Spilo image: $(IMAGE_FULL)"
	cd docker && docker build \
		-f Dockerfile.spilo-citus-pgvector \
		-t $(IMAGE_FULL) \
		.
	@echo "✓ Image built: $(IMAGE_FULL)"

.PHONY: push-image
push-image: check-env ## Push custom image to registry
	@echo "Pushing image: $(IMAGE_FULL)"
	docker push $(IMAGE_FULL)
	@echo "✓ Image pushed: $(IMAGE_FULL)"

.PHONY: build-push
build-push: build-image push-image ## Build and push image

.PHONY: update-manifests
update-manifests: check-env ## Update manifests with image registry
	@echo "Updating manifests with image: $(IMAGE_FULL)"
	@find coordinator workers -name "*.yaml" -type f -exec \
		sed -i.bak "s|dockerImage:.*|dockerImage: $(IMAGE_FULL)|g" {} \;
	@find coordinator workers -name "*.yaml.bak" -type f -delete
	@echo "✓ Manifests updated"

.PHONY: deploy-coordinator
deploy-coordinator: ## Deploy Citus coordinator
	@echo "Deploying Citus coordinator..."
	kubectl apply -f operator/configmap.yaml
	kubectl apply -f coordinator/citus-coordinator.yaml
	@echo "Waiting for coordinator to be ready..."
	kubectl wait --for=condition=Ready pod -l cluster-name=citus-coordinator --timeout=300s || true
	@echo "✓ Coordinator deployed"

.PHONY: deploy-workers
deploy-workers: ## Deploy Citus workers
	@echo "Deploying Citus workers..."
	kubectl apply -f workers/
	@echo "Waiting for workers to be ready..."
	kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-1 --timeout=300s || true
	kubectl wait --for=condition=Ready pod -l cluster-name=citus-worker-2 --timeout=300s || true
	@echo "✓ Workers deployed"

.PHONY: deploy
deploy: deploy-coordinator deploy-workers ## Deploy complete Citus cluster

.PHONY: deploy-kustomize
deploy-kustomize: ## Deploy using Kustomize
	@echo "Deploying with Kustomize..."
	kubectl apply -k .
	@echo "✓ Cluster deployed via Kustomize"

.PHONY: status
status: ## Show cluster status
	@echo "=== PostgreSQL Clusters ==="
	@kubectl get postgresql
	@echo ""
	@echo "=== Pods ==="
	@kubectl get pods -l app=citus
	@echo ""
	@echo "=== Services ==="
	@kubectl get svc -l app=citus
	@echo ""
	@echo "=== PVCs ==="
	@kubectl get pvc -l app=citus

.PHONY: logs-coordinator
logs-coordinator: ## Show coordinator logs
	@kubectl logs -l cluster-name=citus-coordinator,spilo-role=master --tail=100 -f

.PHONY: logs-worker1
logs-worker1: ## Show worker-1 logs
	@kubectl logs -l cluster-name=citus-worker-1,spilo-role=master --tail=100 -f

.PHONY: logs-worker2
logs-worker2: ## Show worker-2 logs
	@kubectl logs -l cluster-name=citus-worker-2,spilo-role=master --tail=100 -f

.PHONY: get-password
get-password: ## Get coordinator password
	@echo "Coordinator password:"
	@kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do \
		-o jsonpath='{.data.password}' | base64 --decode
	@echo ""

.PHONY: connect
connect: ## Connect to coordinator via port-forward
	@echo "Port-forwarding coordinator to localhost:5432..."
	@echo "Password: $$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do -o jsonpath='{.data.password}' | base64 --decode)"
	@echo "Connect with: psql -h localhost -U postgres"
	@kubectl port-forward svc/citus-coordinator 5432:5432

.PHONY: verify
verify: ## Verify Citus cluster
	@echo "Verifying Citus cluster..."
	@export PGPASSWORD=$$(kubectl get secret postgres.citus-coordinator.credentials.postgresql.acid.zalan.do -o jsonpath='{.data.password}' | base64 --decode) && \
		kubectl port-forward svc/citus-coordinator 5432:5432 & \
		PF_PID=$$! && \
		sleep 3 && \
		psql -h localhost -U postgres -c "SELECT * FROM citus_get_active_worker_nodes();" && \
		psql -h localhost -U postgres -c "SELECT * FROM pg_extension WHERE extname IN ('citus', 'vector');" && \
		kill $$PF_PID

.PHONY: scale-workers
scale-workers: ## Scale workers (usage: make scale-workers WORKERS=3)
	@echo "Scaling to $(WORKERS) workers not yet implemented"
	@echo "Please create additional worker manifests manually"

.PHONY: restart-coordinator
restart-coordinator: ## Restart coordinator
	@kubectl delete pod -l cluster-name=citus-coordinator,spilo-role=master

.PHONY: restart-workers
restart-workers: ## Restart all workers
	@kubectl delete pod -l app=citus,role=worker,spilo-role=master

.PHONY: clean
clean: ## Delete Citus cluster (keeps operator)
	@echo "Deleting Citus cluster..."
	@kubectl delete postgresql citus-coordinator citus-worker-1 citus-worker-2 --wait=false || true
	@echo "Waiting for cleanup..."
	@sleep 5
	@echo "✓ Cluster deleted (PVCs preserved)"

.PHONY: clean-all
clean-all: clean ## Delete everything including PVCs
	@echo "Deleting PVCs..."
	@kubectl delete pvc -l app=citus
	@echo "✓ All resources deleted"

.PHONY: uninstall-operator
uninstall-operator: ## Uninstall Postgres Operator
	@echo "Uninstalling Postgres Operator..."
	@helm uninstall postgres-operator -n postgres-operator || true
	@kubectl delete namespace postgres-operator || true
	@echo "✓ Operator uninstalled"

.PHONY: full-install
full-install: check-env install-operator build-push update-manifests deploy ## Complete installation from scratch

.PHONY: monitoring
monitoring: ## Port-forward to Patroni API for monitoring
	@echo "Port-forwarding Patroni API to localhost:8008..."
	@echo "Access at: http://localhost:8008/patroni"
	@kubectl port-forward svc/citus-coordinator 8008:8008
