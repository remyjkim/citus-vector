# pgvector Schema Recommendations for Citus Cluster

## Distribution Strategy

### Primary Distribution Column: `channel_id`

The `chunks` table is distributed by `channel_id` for optimal query performance:

```sql
SELECT create_distributed_table('chunks', 'channel_id');
```

**Rationale**: Queries will primarily search for similar content within a specific channel context, making `channel_id` the ideal distribution column.

### Query Routing Behavior

| Query Pattern | Routing Type | Shards Queried | Expected Latency |
|---------------|--------------|----------------|------------------|
| `WHERE channel_id = X` | Router | 1 | 5-20ms |
| `WHERE channel_id = X AND user_id = Y` | Router | 1 | 5-20ms |
| `WHERE user_id = Y` (no channel_id) | Parallel | All | 50-200ms |
| No WHERE clause | Parallel | All | 50-200ms |

## Schema Design

### Current Schema (Updated)

```sql
CREATE TABLE "chunks" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "channel_id" bigint NOT NULL,          -- Distribution column
    "user_id" bigint NOT NULL,             -- Secondary filter
    "writer_channel_id" bigint,            -- Optional association
    "content" text NOT NULL,               -- Text content
    "embedding" vector(1536) NOT NULL,     -- OpenAI embedding (1536 dims)
    "metadata" jsonb,                      -- Flexible metadata storage
    "created_at" timestamp DEFAULT now() NOT NULL
);
```

### Index Strategy

```sql
-- 1. HNSW index for vector similarity (primary index)
CREATE INDEX ON "chunks" USING hnsw ("embedding" vector_cosine_ops);

-- 2. B-tree index for user_id filtering
CREATE INDEX ON "chunks" ("user_id");

-- 3. B-tree index for time-based queries
CREATE INDEX ON "chunks" ("created_at");

-- 4. GIN index for metadata JSONB queries (only when metadata exists)
CREATE INDEX ON "chunks" USING gin ("metadata") WHERE metadata IS NOT NULL;
```

### Why HNSW Over IVFFlat?

| Feature | HNSW | IVFFlat |
|---------|------|---------|
| Query Speed | Faster (2-10ms) | Slower (10-50ms) |
| Build Speed | Slower (12-42x) | Faster |
| Memory Usage | Higher | Lower |
| Dynamic Updates | Excellent | Poor (needs rebuild) |
| Training Required | No | Yes (requires data) |

**Recommendation**: HNSW for production use cases with frequent inserts/updates and query performance priority.

## Query Patterns

### ✅ OPTIMAL: Router Query with channel_id

```sql
-- Queries ONE shard only
SELECT
    id,
    content,
    user_id,
    embedding <=> $1::vector AS distance
FROM chunks
WHERE channel_id = $2              -- Router to single shard
  AND user_id = $3                 -- Additional filter on shard
  AND created_at > NOW() - INTERVAL '30 days'
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Performance**: 5-20ms (single-shard lookup + HNSW index)

### ⚠️ ACCEPTABLE: Filtered Parallel Query

```sql
-- Queries ALL shards but with time filter to reduce data
SELECT
    id,
    content,
    channel_id,
    embedding <=> $1::vector AS distance
FROM chunks
WHERE created_at > NOW() - INTERVAL '7 days'  -- Reduces scan size
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Performance**: 30-100ms (parallel query with filter)

### ❌ SLOW: Global Unfiltered Search

```sql
-- Queries ALL shards, full table scan
SELECT
    id,
    content,
    embedding <=> $1::vector AS distance
FROM chunks
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Performance**: 50-200ms+ (parallel query, all shards, all data)

**Avoid unless absolutely necessary.**

## Application-Level Best Practices

### 1. Always Provide channel_id When Possible

```typescript
// ✅ GOOD: Includes distribution column
const results = await db.query(`
    SELECT id, content, embedding <=> $1::vector AS distance
    FROM chunks
    WHERE channel_id = $2
    ORDER BY embedding <=> $1::vector
    LIMIT 10
`, [queryEmbedding, channelId]);

// ❌ BAD: Missing distribution column
const results = await db.query(`
    SELECT id, content, embedding <=> $1::vector AS distance
    FROM chunks
    WHERE user_id = $2
    ORDER BY embedding <=> $1::vector
    LIMIT 10
`, [queryEmbedding, userId]);
```

### 2. Use Prepared Statements

```typescript
// Prepare once
await db.query('PREPARE search_chunks AS ' +
    'SELECT id, content, embedding <=> $1::vector AS distance ' +
    'FROM chunks WHERE channel_id = $2 ' +
    'ORDER BY embedding <=> $1::vector LIMIT $3');

// Execute many times (faster)
const result = await db.query(
    'EXECUTE search_chunks($1, $2, $3)',
    [embedding, channelId, limit]
);
```

### 3. Batch Inserts

```typescript
// ✅ GOOD: Bulk insert
const values = chunks.map((chunk, i) =>
    `($${i*5+1}, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5})`
).join(',');

await db.query(`
    INSERT INTO chunks (channel_id, user_id, content, embedding, metadata)
    VALUES ${values}
`, chunks.flatMap(c => [c.channel_id, c.user_id, c.content, c.embedding, c.metadata]));

// ❌ BAD: Individual inserts
for (const chunk of chunks) {
    await db.query(
        'INSERT INTO chunks (channel_id, user_id, content, embedding) VALUES ($1, $2, $3, $4)',
        [chunk.channel_id, chunk.user_id, chunk.content, chunk.embedding]
    );
}
```

## Configuration Recommendations

### Database-Level Settings

**Critical**: Session-level settings don't propagate to Citus workers. Must set at database level.

```sql
-- Connect to coordinator
\c postgres

-- pgvector query tuning
ALTER DATABASE postgres SET hnsw.ef_search = 200;
-- Default: 40, Range: 10-1000
-- Higher = better recall, slower queries
-- 200 is good balance for most use cases

-- Index building performance
ALTER DATABASE postgres SET maintenance_work_mem = '2GB';
-- Default: 64MB
-- Higher = faster index builds
-- Recommendation: 1-4GB depending on available RAM

-- Parallel query execution
ALTER DATABASE postgres SET max_parallel_workers_per_gather = 4;
-- Default: 2
-- Higher = faster parallel queries (when not using router queries)
-- Recommendation: Match CPU core count per worker

-- Reconnect for settings to take effect
\c
```

### Per-Query Tuning (Advanced)

```sql
-- Temporary override for specific query
SET LOCAL hnsw.ef_search = 400;  -- Higher accuracy for important query

SELECT id, content, embedding <=> '[...]'::vector AS distance
FROM chunks
WHERE channel_id = 123
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;
```

## Monitoring & Optimization

### Check Shard Distribution

```sql
-- View shard placement across workers
SELECT
    nodename,
    COUNT(*) as shard_count,
    pg_size_pretty(SUM(shard_size)) as total_size
FROM citus_shards
WHERE table_name::text = 'chunks'
GROUP BY nodename
ORDER BY nodename;
```

### Check Index Usage

```sql
-- Verify HNSW index is being used
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, content, embedding <=> '[0.1, 0.2, ...]'::vector AS distance
FROM chunks
WHERE channel_id = 1
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;

-- Look for: "Index Scan using chunks_embedding_idx"
```

### Query Performance Statistics

```sql
-- View query statistics (requires pg_stat_statements)
SELECT
    query,
    calls,
    mean_exec_time,
    stddev_exec_time,
    max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%chunks%embedding%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Scaling Guidelines

### When to Add Workers

| Dataset Size | Workers | Shards/Worker | Expected Performance |
|--------------|---------|---------------|----------------------|
| < 1M vectors | 1-2 | 32-16 | 5-10ms (router) |
| 1-5M vectors | 2-3 | 16-11 | 5-15ms (router) |
| 5-10M vectors | 3-5 | 11-6 | 10-20ms (router) |
| > 10M vectors | 5+ | < 6 | 15-30ms (router) |

### Shard Count Considerations

Default: 32 shards (configured by `citus.shard_count`)

**Don't change** unless:
- Very large datasets (> 100M rows) → increase to 64-128
- Very small datasets (< 100K rows) → decrease to 16

**Trade-offs**:
- More shards = finer rebalancing granularity, more overhead
- Fewer shards = less overhead, coarser rebalancing

## Migration Strategy

### From Standalone PostgreSQL

If migrating from single-node PostgreSQL:

```sql
-- 1. Create distributed table (without data)
CREATE TABLE chunks_distributed (LIKE chunks);
SELECT create_distributed_table('chunks_distributed', 'channel_id');

-- 2. Copy data (may take time for large datasets)
INSERT INTO chunks_distributed SELECT * FROM chunks;

-- 3. Create indexes on distributed table
CREATE INDEX ON chunks_distributed USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON chunks_distributed (user_id);
CREATE INDEX ON chunks_distributed (created_at);

-- 4. Swap tables (in transaction)
BEGIN;
ALTER TABLE chunks RENAME TO chunks_old;
ALTER TABLE chunks_distributed RENAME TO chunks;
COMMIT;

-- 5. Drop old table after verification
DROP TABLE chunks_old;
```

## Troubleshooting

### Slow Query Performance

**Problem**: Queries taking > 100ms

**Diagnosis**:
```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ... FROM chunks WHERE channel_id = X ORDER BY embedding <=> ... LIMIT 10;
```

**Common Issues**:
1. **Missing channel_id filter** → Add distribution column to WHERE clause
2. **Sequential scan** → Index not being used, check `hnsw.ef_search` setting
3. **Large result set** → Reduce LIMIT, add more filters
4. **Index not created** → Verify index exists: `\d chunks`

### High Memory Usage During Index Build

**Problem**: Out of memory during `CREATE INDEX`

**Solution**:
```sql
-- Temporarily increase memory for this session
SET maintenance_work_mem = '4GB';

-- Build index
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- Reset
RESET maintenance_work_mem;
```

### Recall Rate Lower Than Expected

**Problem**: Not finding relevant vectors

**Solution**:
```sql
-- Increase ef_search for better accuracy
ALTER DATABASE postgres SET hnsw.ef_search = 400;

-- Reconnect
\c

-- Verify setting
SHOW hnsw.ef_search;
```

## Summary

### Key Takeaways

1. ✅ **Always filter by `channel_id`** for optimal performance
2. ✅ **Use HNSW indexes** for production workloads
3. ✅ **Set database-level GUC variables** (not session-level)
4. ✅ **Batch inserts** for better write performance
5. ✅ **Monitor shard distribution** and rebalance when adding workers
6. ❌ **Avoid global unfiltered searches** unless absolutely necessary
7. ❌ **Don't use session-level settings** for pgvector (won't propagate to workers)

### Expected Performance

| Scenario | Latency | Throughput |
|----------|---------|------------|
| Router query (channel_id filter) | 5-20ms | 100-200 QPS/worker |
| Parallel query (no filter) | 50-200ms | 10-20 QPS total |
| Bulk insert (1000 rows) | 100-500ms | 2K-10K rows/sec |
| Index build (1M vectors) | 5-20 min | N/A |

### Next Steps

1. Start cluster: `cd compose && docker-compose up -d --build`
2. Run migration: Apply updated schema to `postgres` database
3. Configure settings: Run ALTER DATABASE commands for pgvector tuning
4. Test queries: Verify router queries are hitting single shard
5. Monitor performance: Use `EXPLAIN ANALYZE` to validate query plans
