# Task 02: Dual Embedding Options - OpenAI + Local Client-Side Models

## Overview
Extend the vector search application to support **two parallel embedding strategies**: server-side OpenAI embeddings (1536 dimensions) and client-side local embeddings using @xenova/transformers (384 dimensions). This enables users to choose between API-based embeddings with higher quality or free local embeddings with lower latency.

## Problem Statement

### Critical Dimension Incompatibility
- **Current State**: Database uses `vector(1536)` for OpenAI text-embedding-3-small
- **Proposed Local Models**: 384 dimensions (all-MiniLM-L6-v2, gte-small, bge-small, e5-small)
- **PostgreSQL Constraint**: Vector columns have **fixed dimensions** - cannot mix 1536-dim and 384-dim vectors in same column

### Business Requirements
1. Support both OpenAI API embeddings (paid, high quality) and local embeddings (free, good quality)
2. Allow users to choose embedding provider at search time
3. Maintain backward compatibility with existing data
4. Enable side-by-side comparison of embedding quality
5. Support client-side embedding generation to reduce API costs

---

## Architecture Decision

### P SELECTED APPROACH: Dual Column Architecture (Option 1)

**Strategy**: Maintain two separate vector columns with different dimensions, allowing both embedding types to coexist.

**Rationale**:
-  **Zero Data Loss**: Existing embeddings preserved
-  **Backward Compatible**: No breaking changes
-  **Flexible**: Users choose provider per search
-  **Comparable**: Can A/B test embedding quality
-  **Cost Optimized**: Option to use free local embeddings
-  **Citus-Friendly**: Storage overhead minimal in distributed setup

**Trade-offs Accepted**:
- ~2x storage for chunks with both embeddings (acceptable given Citus scalability)
- Slightly more complex queries (manageable with proper abstraction)
- UI complexity for provider selection (improved UX with defaults)

### Alternative Approaches Considered

#### Option 2: Single Column with Forced Choice
- **Rejected**: Requires destructive migration, loses existing data
- **Reason**: Violates backward compatibility requirement

#### Option 3: Dimension Normalization
- **Rejected**: Reduces OpenAI embedding quality to 384 dimensions
- **Reason**: Defeats purpose of supporting high-quality embeddings

---

## Database Schema Changes

### Current Schema
```typescript
export const chunks = pgTable('chunks', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  channelId: bigint('channel_id', { mode: 'number' }).notNull(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  writerChannelId: bigint('writer_channel_id', { mode: 'number' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),  // Current
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### New Schema
```typescript
export const chunks = pgTable('chunks', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  channelId: bigint('channel_id', { mode: 'number' }).notNull(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  writerChannelId: bigint('writer_channel_id', { mode: 'number' }),
  content: text('content').notNull(),

  // Dual embedding columns
  embeddingOpenai: vector('embedding_openai', { dimensions: 1536 }),
  embeddingLocal: vector('embedding_local', { dimensions: 384 }),
  embeddingProvider: text('embedding_provider').default('openai'), // 'openai' | 'local' | 'both'

  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.channelId] })
}));
```

### Migration Strategy
```sql
-- Step 1: Add new columns (nullable initially)
ALTER TABLE chunks ADD COLUMN embedding_openai vector(1536);
ALTER TABLE chunks ADD COLUMN embedding_local vector(384);
ALTER TABLE chunks ADD COLUMN embedding_provider text DEFAULT 'openai';

-- Step 2: Migrate existing data
UPDATE chunks SET embedding_openai = embedding WHERE embedding IS NOT NULL;

-- Step 3: Drop old column (after verification)
ALTER TABLE chunks DROP COLUMN embedding;

-- Step 4: Create indexes
CREATE INDEX ON chunks USING hnsw (embedding_openai vector_cosine_ops);
CREATE INDEX ON chunks USING hnsw (embedding_local vector_cosine_ops);
```

---

## Implementation Phases

### Phase 1: Backend Infrastructure (TDD)
**Goal**: Add dual embedding support to API layer

#### 1.1 Update Database Schema
**File**: `db/schema.ts`
- [ ] Write test: New schema types compile correctly
- [ ] Rename `embedding` to `embeddingOpenai`
- [ ] Add `embeddingLocal` column (384 dimensions)
- [ ] Add `embeddingProvider` column
- [ ] Update TypeScript types (Chunk, NewChunk)
- [ ] Verify type safety

**Test**: Schema compiles without TypeScript errors

#### 1.2 Create Migration
**File**: `db/migrations/0001_add_dual_embeddings.sql`
- [ ] Write test: Migration runs without errors
- [ ] Add new columns (nullable initially)
- [ ] Migrate existing `embedding` data to `embedding_openai`
- [ ] Drop old `embedding` column
- [ ] Add provider column with default
- [ ] Create HNSW indexes for both embedding columns
- [ ] Verify migration with test queries

**Test**: Migration executes successfully, data preserved

#### 1.3 Add Local Embedding Service
**File**: `server/embeddings/local-embeddings.ts`
- [ ] Write test: Local embedding generation produces 384-dim vectors
- [ ] Install `@xenova/transformers` dependency
- [ ] Create singleton pipeline for 'all-MiniLM-L6-v2'
- [ ] Implement `generateLocalEmbedding(text: string): Promise<number[]>`
- [ ] Add caching mechanism for model loading
- [ ] Handle errors gracefully
- [ ] Add model warmup on server start

**Test**: Function returns valid 384-dimensional embedding vector

```typescript
// server/embeddings/local-embeddings.ts
import { pipeline } from '@xenova/transformers';

let embedder: any = null;

export async function initLocalEmbeddings() {
  if (!embedder) {
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { cache_dir: './models' }
    );
  }
  return embedder;
}

export async function generateLocalEmbedding(text: string): Promise<number[]> {
  const model = await initLocalEmbeddings();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
```

#### 1.4 Update OpenAI Embedding Service
**File**: `server/embeddings/openai-embeddings.ts`
- [ ] Write test: OpenAI embedding generation produces 1536-dim vectors
- [ ] Extract OpenAI embedding logic from routes
- [ ] Create `generateOpenAIEmbedding(text: string): Promise<number[]>`
- [ ] Add retry logic with exponential backoff
- [ ] Handle rate limiting
- [ ] Add error handling

**Test**: Function returns valid 1536-dimensional embedding vector

```typescript
// server/embeddings/openai-embeddings.ts
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}
```

#### 1.5 Create Embedding Factory
**File**: `server/embeddings/index.ts`
- [ ] Write test: Factory routes to correct provider
- [ ] Create provider enum type: `'openai' | 'local'`
- [ ] Implement `generateEmbedding(text: string, provider: Provider)`
- [ ] Route to appropriate embedding function
- [ ] Validate provider parameter
- [ ] Return typed response with dimension validation

**Test**: Factory correctly delegates to OpenAI or local embeddings

```typescript
// server/embeddings/index.ts
export type EmbeddingProvider = 'openai' | 'local';

export async function generateEmbedding(
  text: string,
  provider: EmbeddingProvider
): Promise<{ embedding: number[]; dimensions: number }> {
  if (provider === 'openai') {
    const embedding = await generateOpenAIEmbedding(text);
    return { embedding, dimensions: 1536 };
  } else if (provider === 'local') {
    const embedding = await generateLocalEmbedding(text);
    return { embedding, dimensions: 384 };
  }
  throw new Error(`Unknown provider: ${provider}`);
}
```

---

### Phase 2: API Endpoint Updates (TDD)
**Goal**: Modify API routes to support dual embeddings

#### 2.1 Update Search Endpoint
**File**: `server/routes.ts` - POST `/api/search`
- [ ] Write test: Search with 'openai' provider uses embedding_openai
- [ ] Write test: Search with 'local' provider uses embedding_local
- [ ] Write test: Search defaults to 'openai' when provider not specified
- [ ] Add `provider` parameter to request body
- [ ] Validate provider is 'openai' or 'local'
- [ ] Generate embedding using provider
- [ ] Query against appropriate column (embedding_openai or embedding_local)
- [ ] Return results with provider info

**Request Schema**:
```typescript
{
  text: string;
  provider?: 'openai' | 'local';  // defaults to 'openai'
  limit?: number;
}
```

**Implementation**:
```typescript
app.post('/search', async (c) => {
  const { text, provider = 'openai', limit = 5 } = await c.req.json();

  const { embedding } = await generateEmbedding(text, provider);

  const embeddingColumn = provider === 'openai'
    ? chunks.embeddingOpenai
    : chunks.embeddingLocal;

  const results = await db
    .select()
    .from(chunks)
    .where(isNotNull(embeddingColumn))
    .orderBy(cosineDistance(embeddingColumn, embedding))
    .limit(limit);

  return c.json({ results, provider });
});
```

**Test**: Search returns correct results for both providers

#### 2.2 Update Embed Endpoint
**File**: `server/routes.ts` - POST `/api/embed`
- [ ] Write test: Embed with 'openai' returns 1536-dim vector
- [ ] Write test: Embed with 'local' returns 384-dim vector
- [ ] Add `provider` parameter to request body
- [ ] Generate embedding using provider
- [ ] Return embedding with dimension info

**Request Schema**:
```typescript
{
  text: string;
  provider?: 'openai' | 'local';
}
```

**Test**: Endpoint returns embeddings with correct dimensions

#### 2.3 Update Chunks Upsert Endpoint
**File**: `server/routes.ts` - POST `/api/chunks/upsert`
- [ ] Write test: Upsert with 'openai' generates and stores OpenAI embedding
- [ ] Write test: Upsert with 'local' generates and stores local embedding
- [ ] Write test: Upsert with 'both' generates both embeddings
- [ ] Add `provider` parameter ('openai' | 'local' | 'both')
- [ ] Generate embedding(s) based on provider
- [ ] Store in appropriate column(s)
- [ ] Update `embedding_provider` field

**Request Schema**:
```typescript
{
  text: string;
  channelId: number;
  userId: number;
  writerChannelId?: number;
  metadata?: object;
  id?: number;
  provider?: 'openai' | 'local' | 'both';  // defaults to 'openai'
}
```

**Test**: Chunks created with correct embedding(s) based on provider

#### 2.4 Add Validation Middleware
**File**: `server/middleware/validation.ts`
- [ ] Write test: Middleware rejects invalid providers
- [ ] Write test: Middleware validates embedding dimensions
- [ ] Create provider validation function
- [ ] Create embedding dimension validation
- [ ] Add error responses with helpful messages

**Test**: Invalid requests return 400 with descriptive errors

---

### Phase 3: Frontend Client-Side Embeddings (TDD)
**Goal**: Enable local embedding generation in browser

#### 3.1 Install Frontend Dependencies
**File**: `node-app/package.json`
- [ ] Add `@xenova/transformers` to frontend dependencies
- [ ] Verify build size impact (~23MB for all-MiniLM-L6-v2)
- [ ] Test installation

**Test**: Dependencies install without errors

#### 3.2 Create Client-Side Embedding Service
**File**: `src/embeddings/client-embeddings.ts`
- [ ] Write test: Client embedding generation works in browser
- [ ] Import `@xenova/transformers`
- [ ] Create singleton pipeline instance
- [ ] Implement `generateClientEmbedding(text: string)`
- [ ] Add loading state management
- [ ] Handle WASM initialization errors
- [ ] Add progress callback for model download

```typescript
// src/embeddings/client-embeddings.ts
import { pipeline } from '@xenova/transformers';

let embedder: any = null;
let loading = false;

export async function initClientEmbeddings(
  onProgress?: (progress: number) => void
): Promise<void> {
  if (embedder) return;
  if (loading) return;

  loading = true;
  try {
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      {
        progress_callback: (data: any) => {
          if (onProgress && data.progress) {
            onProgress(data.progress);
          }
        }
      }
    );
  } finally {
    loading = false;
  }
}

export async function generateClientEmbedding(text: string): Promise<number[]> {
  if (!embedder) {
    await initClientEmbeddings();
  }

  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function isEmbedderReady(): boolean {
  return embedder !== null;
}
```

**Test**: Client-side embedding generation produces 384-dim vectors

#### 3.3 Update API Client
**File**: `src/api.ts`
- [ ] Write test: API client includes provider parameter
- [ ] Add `provider` parameter to `searchVectors` function
- [ ] Add `provider` parameter to embedding requests
- [ ] Update TypeScript interfaces
- [ ] Add client-side embedding option

**Updates**:
```typescript
export interface SearchRequest {
  text: string;
  provider?: 'openai' | 'local';
  limit?: number;
}

export async function searchVectors(
  text: string,
  provider: 'openai' | 'local' = 'openai',
  limit: number = 5
): Promise<Chunk[]> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, provider, limit }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Search failed');
  }

  const data = await response.json();
  return data.results;
}
```

**Test**: API client sends provider parameter correctly

---

### Phase 4: UI Updates (TDD)
**Goal**: Add provider selection and client-side embedding UI

#### 4.1 Create Provider Selection Component
**File**: `src/components/ProviderSelector.tsx`
- [ ] Write test: Component renders radio buttons for providers
- [ ] Write test: Selection triggers callback
- [ ] Create radio button group for 'openai' | 'local'
- [ ] Add descriptions for each provider
- [ ] Show model info (dimensions, cost)
- [ ] Highlight selected provider
- [ ] Add tooltips with pros/cons

```tsx
interface ProviderSelectorProps {
  provider: 'openai' | 'local';
  onChange: (provider: 'openai' | 'local') => void;
  disabled?: boolean;
}

export default function ProviderSelector({
  provider,
  onChange,
  disabled
}: ProviderSelectorProps) {
  return (
    <div>
      <label>
        <input
          type="radio"
          value="openai"
          checked={provider === 'openai'}
          onChange={(e) => onChange('openai')}
          disabled={disabled}
        />
        OpenAI (1536-dim, API required)
      </label>

      <label>
        <input
          type="radio"
          value="local"
          checked={provider === 'local'}
          onChange={(e) => onChange('local')}
          disabled={disabled}
        />
        Local Model (384-dim, runs in browser)
      </label>
    </div>
  );
}
```

**Test**: Component renders and handles selection

#### 4.2 Add Model Loading Indicator
**File**: `src/components/ModelLoadingStatus.tsx`
- [ ] Write test: Component shows loading state
- [ ] Write test: Component shows ready state
- [ ] Display model download progress
- [ ] Show model size and initialization status
- [ ] Handle loading errors
- [ ] Add retry button on failure

**Test**: Component displays loading states correctly

#### 4.3 Update SearchBox Component
**File**: `src/components/SearchBox.tsx`
- [ ] Write test: SearchBox includes provider selector
- [ ] Write test: Changing provider updates search behavior
- [ ] Add ProviderSelector component
- [ ] Add model initialization on mount (for local)
- [ ] Show loading indicator during model download
- [ ] Update search handler to pass provider
- [ ] Add client-side embedding option (generate locally, search on server)

**Implementation**:
```tsx
export default function SearchBox({ onSearch, isLoading }: SearchBoxProps) {
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<'openai' | 'local'>('openai');
  const [modelReady, setModelReady] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);

  useEffect(() => {
    if (provider === 'local') {
      initClientEmbeddings((progress) => setModelProgress(progress))
        .then(() => setModelReady(true))
        .catch(console.error);
    }
  }, [provider]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    onSearch(input.trim(), provider);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Enter search query..."
      />

      <ProviderSelector
        provider={provider}
        onChange={setProvider}
        disabled={isLoading}
      />

      {provider === 'local' && !modelReady && (
        <ModelLoadingStatus progress={modelProgress} />
      )}

      <button
        type="submit"
        disabled={isLoading || (provider === 'local' && !modelReady)}
      >
        {isLoading ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
```

**Test**: SearchBox integrates provider selection correctly

#### 4.4 Update App Component
**File**: `src/App.tsx`
- [ ] Write test: App handles provider parameter
- [ ] Update search handler to accept provider
- [ ] Pass provider to API call
- [ ] Display active provider in results
- [ ] Handle errors for missing API keys

**Implementation**:
```tsx
const handleSearch = async (text: string, provider: 'openai' | 'local') => {
  setIsLoading(true);
  setError(null);

  try {
    const searchResults = await searchVectors(text, provider, 5);
    setResults(searchResults);
    setActiveProvider(provider);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Search failed');
    setResults([]);
  } finally {
    setIsLoading(false);
  }
};
```

**Test**: App completes search with both providers

#### 4.5 Update ResultsList Component
**File**: `src/components/ResultsList.tsx`
- [ ] Write test: Results display provider info
- [ ] Show which embedding provider was used
- [ ] Display embedding dimensions
- [ ] Add visual indicator for provider type

**Test**: Results show provider information

---

### Phase 5: Database Migration & Testing (TDD)
**Goal**: Safely migrate existing data and verify system

#### 5.1 Create Data Migration Script
**File**: `db/migrate-embeddings.ts`
- [ ] Write test: Migration preserves all existing data
- [ ] Write test: Migration creates indexes successfully
- [ ] Create backup recommendation
- [ ] Run ALTER TABLE statements
- [ ] Migrate existing embeddings to new column
- [ ] Create HNSW indexes
- [ ] Verify data integrity
- [ ] Generate migration report

**Test**: Migration completes without data loss

#### 5.2 Update Seed Script
**File**: `db/seed.ts`
- [ ] Write test: Seed creates chunks with both embedding types
- [ ] Generate both OpenAI and local embeddings for seed data
- [ ] Update seed data structure
- [ ] Set appropriate provider values
- [ ] Verify seeded data

**Test**: Seed populates both embedding columns

#### 5.3 Integration Testing
**File**: `tests/integration/dual-embeddings.test.ts`
- [ ] Write test: Search with OpenAI provider returns correct results
- [ ] Write test: Search with local provider returns correct results
- [ ] Write test: Results from both providers overlap for same content
- [ ] Write test: Client-side embedding matches server-side local embedding
- [ ] Write test: Chunk creation with 'both' provider stores both embeddings
- [ ] Test error cases (missing API key, model load failure)

**Test**: All integration tests pass

#### 5.4 Performance Testing
- [ ] Test: Measure OpenAI embedding latency
- [ ] Test: Measure local embedding latency (server)
- [ ] Test: Measure local embedding latency (client)
- [ ] Test: Compare search result quality between providers
- [ ] Test: Measure model download time and size
- [ ] Document performance characteristics

**Test**: Performance meets expectations

---

### Phase 6: Documentation & Polish
**Goal**: Complete documentation and production readiness

#### 6.1 Update README
**File**: `node-app/README.md`
- [ ] Document dual embedding feature
- [ ] Explain provider options and trade-offs
- [ ] Document new API parameters
- [ ] Add setup instructions for local embeddings
- [ ] Document environment variables (OPENAI_API_KEY optional for local-only)
- [ ] Add troubleshooting section
- [ ] Include performance comparison table

#### 6.2 Add Environment Configuration
**File**: `node-app/.env.example`
- [ ] Add `OPENAI_API_KEY` (optional if using local-only)
- [ ] Add `EMBEDDING_PROVIDER_DEFAULT` config
- [ ] Add `ENABLE_CLIENT_EMBEDDINGS` flag
- [ ] Document each variable

#### 6.3 Add Error Handling Documentation
- [ ] Document OpenAI API errors
- [ ] Document model loading errors
- [ ] Document dimension mismatch errors
- [ ] Add troubleshooting guide

#### 6.4 Create Comparison Guide
**File**: `docs/embedding-comparison.md`
- [ ] Compare OpenAI vs local embedding quality
- [ ] Compare costs (API vs free)
- [ ] Compare latency characteristics
- [ ] Recommend use cases for each provider
- [ ] Include example search results side-by-side

---

## Technical Decisions

### Local Embedding Model Selection
**Chosen**: `all-MiniLM-L6-v2` (Xenova)
- **Size**: 23MB (manageable for web)
- **Dimensions**: 384
- **Quality**: Good for most use cases
- **Speed**: Very fast
- **Alternative Models**: gte-small, bge-small (33MB, better quality)

### Embedding Storage Strategy
**Chosen**: Dual columns with nullable values
- Allows gradual migration
- Supports chunks with only one embedding type
- Enables A/B testing
- **Alternative**: Require both embeddings (rejected - too rigid)

### Client vs Server Local Embeddings
**Chosen**: Support both options
- Client: Lower latency, no server load, works offline
- Server: Consistent environment, easier debugging
- Allow user to choose based on use case

### Default Provider
**Chosen**: OpenAI ('openai')
- Higher quality out of the box
- Backward compatible with existing usage
- **Alternative**: Local (rejected - quality trade-off for new users)

### Index Strategy
- Create HNSW index on both embedding columns
- Use `vector_cosine_ops` for both (consistent distance metric)
- Create indexes after data migration for performance
- Consider index parameters: `m=16, ef_construction=64` (defaults)

---

## Migration Checklist

### Pre-Migration
- [ ] Backup database
- [ ] Document current row count
- [ ] Test migration on development database
- [ ] Verify OpenAI API access (if using)

### Migration Steps
1. [ ] Run database migration (adds columns)
2. [ ] Verify existing data in `embedding_openai`
3. [ ] Create HNSW indexes
4. [ ] Update application code
5. [ ] Deploy backend changes
6. [ ] Deploy frontend changes
7. [ ] Verify search functionality with both providers
8. [ ] Monitor for errors

### Post-Migration Verification
- [ ] Verify all existing chunks have `embedding_openai`
- [ ] Verify indexes are used (EXPLAIN ANALYZE)
- [ ] Test search with both providers
- [ ] Monitor API error rates
- [ ] Check model loading in browser

---

## Success Criteria

1.  Database schema supports both embedding types
2.  Migration preserves all existing embeddings
3.  Backend generates OpenAI embeddings (1536-dim)
4.  Backend generates local embeddings (384-dim)
5.  Frontend loads local model in browser
6.  Search works with both providers
7.  Results are comparable between providers
8.  UI allows provider selection
9.  All tests pass (unit + integration)
10.  Documentation complete
11.  No performance regression for OpenAI searches
12.  Local embeddings complete within acceptable time (< 500ms)
13.  Model download completes successfully in browser

---

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| OpenAI embedding generation (server) | < 500ms | API dependent |
| Local embedding generation (server) | < 100ms | After model load |
| Local embedding generation (client) | < 200ms | After model load |
| Model download (first time) | < 30s | 23MB over typical connection |
| Model initialization | < 2s | WASM + model load |
| Search query (either provider) | < 50ms | With HNSW index |

---

## Known Limitations

1. **Dimension Mismatch**: Cannot compare vectors across providers (by design)
2. **Storage Overhead**: ~2x storage for chunks with both embeddings
3. **Quality Difference**: Local embeddings may have lower quality than OpenAI
4. **Browser Compatibility**: Transformers.js requires modern browser with WASM support
5. **Model Download**: First-time users experience ~23MB download
6. **API Dependency**: OpenAI provider requires valid API key and internet

---

## Future Enhancements

### Phase 7 (Future)
- [ ] Add embedding quality metrics (recall@k comparison)
- [ ] Support additional local models (gte-small, bge-small)
- [ ] Add model selection UI
- [ ] Cache embeddings in IndexedDB (client)
- [ ] Add batch embedding endpoint
- [ ] Support hybrid search (vector + keyword)
- [ ] Add embedding visualization
- [ ] Implement automatic re-embedding on content update
- [ ] Add embedding version tracking
- [ ] Support custom embedding models
- [ ] Add cost tracking for OpenAI usage

---

## Security Considerations

1. **API Key Protection**: Ensure OPENAI_API_KEY not exposed to client
2. **Rate Limiting**: Implement rate limiting on embedding endpoints
3. **Input Validation**: Validate text length to prevent abuse
4. **Model Source**: Verify transformers.js model source (Hugging Face CDN)
5. **CORS Configuration**: Properly configure CORS for API access

---

## Rollback Plan

If issues arise during deployment:

1. **Database Rollback**:
   - Add back `embedding` column
   - Copy data from `embedding_openai`
   - Drop new columns
   - Revert application code

2. **Application Rollback**:
   - Revert to previous deployment
   - Database schema remains compatible (new columns nullable)

3. **Partial Rollback**:
   - Disable local embeddings via feature flag
   - Continue using OpenAI-only
   - No database changes needed

---

## Testing Strategy

### Unit Tests
- [ ] Schema type safety
- [ ] Embedding generation (both providers)
- [ ] API route validation
- [ ] Client embedding service
- [ ] Provider selection logic

### Integration Tests
- [ ] End-to-end search with OpenAI
- [ ] End-to-end search with local
- [ ] Chunk creation with both embeddings
- [ ] Migration data integrity
- [ ] Index usage verification

### Manual Testing
- [ ] Search quality comparison
- [ ] Model download in browser
- [ ] Error handling (no API key, network failure)
- [ ] UI responsiveness
- [ ] Cross-browser compatibility (Chrome, Firefox, Safari)

### Performance Tests
- [ ] Embedding generation latency
- [ ] Search query latency
- [ ] Model load time
- [ ] Concurrent request handling

---

## Acceptance Criteria for Remy

Before marking this task complete, verify:

1. **Database**:
   - [ ] Schema migration completed successfully
   - [ ] Existing data preserved in `embedding_openai` column
   - [ ] Both HNSW indexes created and functional
   - [ ] No data loss confirmed

2. **Backend**:
   - [ ] OpenAI embeddings generate correctly (1536 dims)
   - [ ] Local embeddings generate correctly (384 dims)
   - [ ] Search works with both providers
   - [ ] All API endpoints accept provider parameter
   - [ ] Error handling covers common failure cases

3. **Frontend**:
   - [ ] Local model loads in browser
   - [ ] Provider selection UI works
   - [ ] Search executes with selected provider
   - [ ] Model loading progress displays
   - [ ] Results show which provider was used

4. **Testing**:
   - [ ] All unit tests pass
   - [ ] All integration tests pass
   - [ ] Manual testing completed
   - [ ] Performance targets met

5. **Documentation**:
   - [ ] README updated with new features
   - [ ] API documentation includes provider parameter
   - [ ] Setup instructions include local embedding info
   - [ ] Troubleshooting guide available

6. **Quality**:
   - [ ] No TypeScript errors
   - [ ] No console errors in browser
   - [ ] Code follows existing patterns
   - [ ] ABOUTME comments added to new files
   - [ ] All rules from CLAUDE.md followed

---

## Notes

- **OpenAI API Key**: Required for OpenAI provider, optional for local-only usage
- **Model Caching**: Transformers.js caches models in browser (IndexedDB), subsequent loads faster
- **Citus Compatibility**: Dual columns work seamlessly with Citus distribution
- **Type Safety**: Full TypeScript support for both embedding types
- **Backward Compatibility**: Existing code works without changes (defaults to OpenAI)
