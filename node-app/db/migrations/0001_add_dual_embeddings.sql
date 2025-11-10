-- Migration: Add dual embedding support (OpenAI 1536-dim + Local 384-dim)
-- This migration safely transitions from single 'embedding' column to dual columns

-- Step 1: Add new embedding columns (nullable to allow gradual migration)
ALTER TABLE chunks ADD COLUMN embedding_openai vector(1536);
ALTER TABLE chunks ADD COLUMN embedding_local vector(384);
ALTER TABLE chunks ADD COLUMN embedding_provider text DEFAULT 'openai';

-- Step 2: Migrate existing embeddings to embedding_openai column
-- All existing data uses OpenAI embeddings (1536 dimensions)
UPDATE chunks SET embedding_openai = embedding WHERE embedding IS NOT NULL;
UPDATE chunks SET embedding_provider = 'openai' WHERE embedding IS NOT NULL;

-- Step 3: Drop old embedding column (after data migration)
ALTER TABLE chunks DROP COLUMN embedding;

-- Step 4: Create HNSW indexes for vector similarity search
-- OpenAI embeddings index (1536 dimensions, cosine distance)
CREATE INDEX IF NOT EXISTS chunks_embedding_openai_idx
  ON chunks USING hnsw (embedding_openai vector_cosine_ops);

-- Local embeddings index (384 dimensions, cosine distance)
CREATE INDEX IF NOT EXISTS chunks_embedding_local_idx
  ON chunks USING hnsw (embedding_local vector_cosine_ops);

-- Migration complete
-- Chunks now support both OpenAI (1536-dim) and local (384-dim) embeddings
-- The embedding_provider field tracks which embedding types are available: 'openai', 'local', or 'both'
