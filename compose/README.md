# Citus Docker Compose Setup

A production-ready Citus 13.2 cluster with pgvector support for distributed vector similarity search.

## Architecture

This setup creates a 3-container Citus cluster:

- **Master (Coordinator)**: The main node where clients connect and queries are planned
- **Worker(s)**: Data nodes that execute distributed queries (scalable)
- **Manager**: Auto-discovery service that registers new workers with the master

## pgvector Support

This cluster includes **pgvector 0.8.0+** for vector similarity search:

- **Distributed vector search**: Store and query embeddings across multiple workers
- **HNSW indexes**: Fast approximate nearest neighbor search on each shard
- **Optimal routing**: Use `channel_id` filtering for single-shard queries (fast)
- **Parallel queries**: Search across all shards when needed (slower but comprehensive)

### Performance Characteristics

| Query Type | Shards Queried | Expected Latency |
|------------|----------------|------------------|
| With `channel_id` filter (router query) | 1 | 5-20ms |
| Without filter (parallel query) | All | 50-200ms |

**Best Practice**: Always filter by `channel_id` (distribution column) for optimal performance.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 1.29+

## Quick Start

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and set your PostgreSQL password:
```bash
POSTGRES_PASSWORD=your_secure_password
```

3. Build and start the cluster:
```bash
docker-compose up -d --build
```

**Note**: First build takes ~2-3 minutes (installs pgvector). Subsequent starts are instant.

4. Connect to the coordinator:
```bash
psql -h localhost -p 5432 -U postgres
```

5. Verify the cluster:
```sql
SELECT * FROM master_get_active_worker_nodes();
```

## Scaling Workers

Add more workers at any time:

```bash
# Scale to 3 workers
docker-compose up -d --scale worker=3

# Scale to 5 workers
docker-compose up -d --scale worker=5
```

The manager automatically discovers and registers new workers with the coordinator.

## Configuration

Edit `.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPOSE_PROJECT_NAME` | `citus` | Container name prefix |
| `POSTGRES_USER` | `postgres` | PostgreSQL superuser name |
| `POSTGRES_PASSWORD` | _(required)_ | PostgreSQL password |
| `POSTGRES_HOST_AUTH_METHOD` | `trust` | Authentication method |
| `COORDINATOR_EXTERNAL_PORT` | `5432` | External port for coordinator |

## Stopping the Cluster

```bash
# Stop containers (preserves data)
docker-compose stop

# Stop and remove containers (preserves data volumes)
docker-compose down

# Stop and remove everything including data
docker-compose down -v
```

## Files

- `docker-compose.yml`: Cluster orchestration
- `Dockerfile.citus-pgvector`: Custom image with pgvector extension
- `001-create-citus-extension.sql`: Initializes Citus extension on startup (in image)
- `002-create-pgvector-extension.sql`: Initializes pgvector extension on startup
- `wait-for-manager.sh`: Ensures workers wait for manager readiness (in image)
- `pg_healthcheck`: Health check script for containers (in image)

## How It Works

1. Master starts and creates the Citus extension
2. Manager starts, monitors Docker for worker containers
3. Workers start and wait for manager signal via shared volume
4. Manager registers workers with master when ready
5. Workers become available for distributed queries

## Verification

Check cluster health:

```sql
-- List active workers
SELECT * FROM master_get_active_worker_nodes();

-- Check Citus version
SELECT citus_version();

-- Check pgvector version
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Example: Distributed Vector Table

```sql
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

-- Additional indexes for filtering
CREATE INDEX ON chunks (user_id);
CREATE INDEX ON chunks (created_at);

-- Insert sample data
INSERT INTO chunks (channel_id, user_id, content, embedding)
VALUES (1, 100, 'Sample text', '[0.1, 0.2, 0.3, ...]'::vector(1536));

-- FAST: Router query (queries one shard only)
SELECT id, content, embedding <=> '[0.1, 0.2, 0.3, ...]'::vector AS distance
FROM chunks
WHERE channel_id = 1  -- Distribution column filter!
ORDER BY embedding <=> '[0.1, 0.2, 0.3, ...]'::vector
LIMIT 10;

-- SLOW: Parallel query (queries all shards)
SELECT id, content, embedding <=> '[0.1, 0.2, 0.3, ...]'::vector AS distance
FROM chunks
ORDER BY embedding <=> '[0.1, 0.2, 0.3, ...]'::vector
LIMIT 10;
```

### Query Performance Tips

1. **Always filter by `channel_id`** when possible → Router queries (fast)
2. **Use `user_id` as secondary filter** → Additional filtering on single shard
3. **Avoid global searches** without distribution column filter → Queries all shards (slow)
4. **Use HNSW indexes** for best query performance (vs IVFFlat)
5. **Set database-level GUC variables** (session-level settings don't propagate to workers):

```sql
-- Configure pgvector for better performance
ALTER DATABASE postgres SET hnsw.ef_search = 200;  -- Default 40, higher = better recall
ALTER DATABASE postgres SET maintenance_work_mem = '2GB';  -- For index building
ALTER DATABASE postgres SET max_parallel_workers_per_gather = 4;

-- Reconnect for changes to take effect
```
