# Database Workflow: Citus + pgvector Setup and Seeding

## Summary: Is the Seeding Approach Correct?

**Yes, mostly.** Your coworker's seeding approach is fundamentally sound for Citus, but had two critical issues that have been fixed:

1. ✅ **Fixed**: `serial` → `bigserial` mismatch in schema.ts
2. ✅ **Fixed**: Duplicate distribution/indexing in setup-citus.ts

## Complete Workflow

### 1. Start Cluster

```bash
cd compose
docker-compose up -d --build
```

First build takes ~2-3 minutes (installs pgvector). Subsequent starts are instant.

### 2. Run Migration

```bash
cd ../node-app
npm run db:migrate
```

**What this does:**
- Creates `chunks` table with composite PRIMARY KEY `(id, channel_id)`
- Calls `create_distributed_table('chunks', 'channel_id')` to shard by channel
- Creates HNSW index for vector similarity search
- Creates supporting indexes (user_id, created_at, metadata)

**Critical Citus Requirement:** PRIMARY KEY must include distribution column:
- ❌ Wrong: `PRIMARY KEY (id)`
- ✅ Correct: `PRIMARY KEY (id, channel_id)`

### 3. Configure Performance (Optional but Recommended)

```bash
npm run db:setup-citus
```

**What this does:**
- Sets `hnsw.ef_search = 200` (better recall for vector search)
- Sets `maintenance_work_mem = 2GB` (faster index builds)
- Sets `max_parallel_workers_per_gather = 4` (faster parallel queries)

**Why database-level?** Session-level settings don't propagate to Citus worker nodes.

**After running:** Reconnect to database for settings to take effect.

### 4. Seed Database

```bash
npm run db:seed
```

**What this does:**
- Inserts 20 sample chunks with random embeddings
- Citus routes each row to correct shard based on `channel_id`
- All inserts go through coordinator (master node)

## Seeding Analysis

### ✅ What's Correct

1. **Connection**: Seeds connect to coordinator, not workers directly
2. **Distribution column**: Every row has `channelId` set
3. **Bulk insert**: Uses single `db.insert(chunks).values(array)` statement
4. **Schema mapping**: Drizzle camelCase → SQL snake_case works correctly

### ⚠️ Issues Fixed

#### Issue 1: `serial` vs `bigserial` Mismatch (FIXED)

**Before:**
```typescript
// schema.ts
id: serial('id').notNull(),  // max 2.1 billion

// migration.sql
"id" bigserial  -- max 9.2 quintillion
```

**After:**
```typescript
id: bigserial('id', { mode: 'number' }).notNull(),
```

**Why it matters:** For 10M vectors, `serial` works but is a future limitation. `bigserial` is safer.

#### Issue 2: Duplicate Distribution/Indexing (FIXED)

**Before:**
- Migration: Creates table, distributes, indexes ✅
- setup-citus.ts: Tries to distribute and index again ❌ (fails)

**After:**
- Migration: Handles all schema setup
- setup-citus.ts: Only configures performance settings

### 📊 Performance Considerations

#### Current Approach: INSERT (Good for Small Datasets)

```typescript
// seed.ts - 20 rows
await db.insert(chunks).values(newChunks);
```

**Performance:** ~10-50ms for 20 rows

**Good for:** < 10,000 rows

#### Better for Large Datasets: COPY Protocol

For seeding > 100K rows:

```typescript
import { from } from 'pg-copy-streams';

// Generate CSV or binary data
const copyStream = db.query(from('COPY chunks (channel_id, user_id, content, embedding) FROM STDIN'));

// Pipe data
dataStream.pipe(copyStream);
```

**Performance:** 10-100x faster for bulk loads

**Recommendation:** Current approach is fine for initial development. Consider COPY for production data loads.

## Query Pattern Validation

### ✅ FAST: Router Query

```typescript
// Queries ONE shard (5-20ms)
const results = await db
  .select()
  .from(chunks)
  .where(eq(chunks.channelId, channelId))
  .orderBy(sql`embedding <=> ${queryEmbedding}`)
  .limit(10);
```

**Why fast:** `channelId` filter routes to single shard.

### ⚠️ SLOW: Parallel Query

```typescript
// Queries ALL shards (50-200ms)
const results = await db
  .select()
  .from(chunks)
  .where(eq(chunks.userId, userId))  // Not distribution column!
  .orderBy(sql`embedding <=> ${queryEmbedding}`)
  .limit(10);
```

**Why slow:** Must query every shard and merge results.

**Solution:** Always filter by `channelId` when possible.

## Common Pitfalls

### ❌ Pitfall 1: Session-Level Settings

```typescript
// WRONG: Won't propagate to workers
await sql`SET hnsw.ef_search = 200`;
```

```typescript
// CORRECT: Database-level setting
await sql`ALTER DATABASE postgres SET hnsw.ef_search = 200`;
```

### ❌ Pitfall 2: Missing Distribution Column Filter

```typescript
// SLOW: Queries all shards
await db.select().from(chunks)
  .orderBy(sql`embedding <=> ${vector}`)
  .limit(10);

// FAST: Queries one shard
await db.select().from(chunks)
  .where(eq(chunks.channelId, 123))
  .orderBy(sql`embedding <=> ${vector}`)
  .limit(10);
```

### ❌ Pitfall 3: Forgetting Composite Primary Key

```typescript
// WRONG: Single-column PK fails in Citus
PRIMARY KEY (id)

// CORRECT: Must include distribution column
PRIMARY KEY (id, channel_id)
```

## Verification Commands

### Check Extensions

```bash
docker-compose exec master psql -U postgres -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('citus', 'vector');"
```

Expected:
```
 extname | extversion
---------+------------
 citus   | 13.2-1
 vector  | 0.8.1
```

### Check Workers

```bash
docker-compose exec master psql -U postgres -c "SELECT * FROM master_get_active_worker_nodes();"
```

Expected (1 worker):
```
     node_name     | node_port
-------------------+-----------
 citus_worker_1    |      5432
```

### Check Table Distribution

```bash
docker-compose exec master psql -U postgres -c "SELECT tablename, colocationid, shardcount FROM citus_tables;"
```

Expected:
```
 tablename | colocationid | shardcount
-----------+--------------+------------
 chunks    |            1 |         32
```

### Check Shard Placement

```bash
docker-compose exec master psql -U postgres -c "SELECT nodename, COUNT(*) FROM citus_shards WHERE table_name::text = 'chunks' GROUP BY nodename;"
```

Expected (with 1 worker):
```
     nodename      | count
-------------------+-------
 citus_worker_1    |    32
```

### Test Vector Query

```bash
docker-compose exec master psql -U postgres <<EOF
-- Insert test data
INSERT INTO chunks (channel_id, user_id, content, embedding)
VALUES (1, 100, 'test', array_fill(0.1::float, ARRAY[1536])::vector);

-- Query with channel filter (FAST - router query)
EXPLAIN (ANALYZE, VERBOSE, BUFFERS)
SELECT id, content, embedding <=> array_fill(0.1::float, ARRAY[1536])::vector AS distance
FROM chunks
WHERE channel_id = 1
ORDER BY embedding <=> array_fill(0.1::float, ARRAY[1536])::vector
LIMIT 10;
EOF
```

Look for: `Custom Scan (Citus Adaptive)` and execution time < 20ms

## Scaling the Cluster

### Add Workers

```bash
docker-compose up -d --scale worker=3
```

Wait 30 seconds for manager to register new workers.

### Verify New Workers

```bash
docker-compose exec master psql -U postgres -c "SELECT * FROM master_get_active_worker_nodes();"
```

Expected (3 workers):
```
     node_name     | node_port
-------------------+-----------
 citus_worker_1    |      5432
 citus_worker_2    |      5432
 citus_worker_3    |      5432
```

### Rebalance Shards

```bash
docker-compose exec master psql -U postgres -c "SELECT rebalance_table_shards('chunks');"
```

This moves shards to balance load across all workers.

## Troubleshooting

### Problem: "cannot create constraint on chunks"

**Error:**
```
ERROR:  cannot create constraint on "chunks"
DETAIL:  Distributed relations cannot have UNIQUE, EXCLUDE, or PRIMARY KEY
         constraints that do not include the partition column
```

**Cause:** PRIMARY KEY doesn't include `channel_id`

**Solution:** Use composite key in both schema.ts and migration:
```typescript
// schema.ts
primaryKey({ columns: [table.id, table.channelId] })
```

```sql
-- migration.sql
PRIMARY KEY (id, channel_id)
```

### Problem: Slow Vector Queries

**Symptom:** Queries taking > 100ms

**Diagnosis:**
```bash
EXPLAIN (ANALYZE, VERBOSE)
SELECT * FROM chunks
WHERE channel_id = 1
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;
```

**Common causes:**
1. Missing `channel_id` filter → Add distribution column to WHERE
2. Index not being used → Check `hnsw.ef_search` setting
3. Sequential scan → Verify HNSW index exists: `\d chunks`

### Problem: Settings Not Taking Effect

**Symptom:** `SHOW hnsw.ef_search;` returns default (40) after setting to 200

**Cause:** Set at session level, not database level

**Solution:**
```sql
-- Set at database level
ALTER DATABASE postgres SET hnsw.ef_search = 200;

-- Reconnect
\c
```

### Problem: Worker Not Showing Up

**Symptom:** `master_get_active_worker_nodes()` returns fewer workers than expected

**Diagnosis:**
```bash
# Check manager logs
docker-compose logs manager

# Check worker status
docker-compose ps
```

**Common causes:**
1. Worker container not healthy → Check `docker-compose ps`
2. Manager hasn't detected yet → Wait 30-60 seconds
3. Docker socket not mounted → Check docker-compose.yml manager volumes

## Best Practices Summary

### ✅ DO

1. Always filter by `channel_id` in queries
2. Use `bigserial` for ID columns
3. Include distribution column in PRIMARY KEY
4. Set GUC variables at database level (not session)
5. Batch inserts when possible
6. Monitor query plans with `EXPLAIN ANALYZE`
7. Rebalance shards after adding workers

### ❌ DON'T

1. Use single-column PRIMARY KEY in distributed tables
2. Query without `channel_id` filter (unless necessary)
3. Set session-level GUC variables (won't propagate)
4. Directly connect to worker nodes (always use coordinator)
5. Forget to reconnect after changing database-level settings
6. Run distribution/indexing multiple times

## Next Steps

1. ✅ Cluster is running with pgvector support
2. ✅ Schema fixed (`bigserial`, composite PK)
3. ✅ Migration handles all setup
4. ✅ setup-citus.ts now only configures performance
5. ✅ Seeding approach validated

**Ready to use!**

Run the workflow:
```bash
cd compose && docker-compose up -d --build
cd ../node-app
npm run db:migrate
npm run db:setup-citus
npm run db:seed
```

Then connect and query:
```typescript
import { db } from './db/client';
import { chunks } from './db/schema';
import { eq, sql } from 'drizzle-orm';

const queryVector = /* your 1536-dim embedding */;

const results = await db
  .select()
  .from(chunks)
  .where(eq(chunks.channelId, 123))  // IMPORTANT: Use distribution column
  .orderBy(sql`embedding <=> ${queryVector}`)
  .limit(10);
```
