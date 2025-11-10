# Task 01: Vector Search App with Drizzle ORM + Hono + React/Vite

## Overview
Build a simple vector search React application using Drizzle ORM for database interactions, Hono for the API backend, and Vite for the frontend. The app will perform vector similarity search on a `chunks` table using pgvector.

## Database Connection
- **DATABASE_URL**: `postgresql://postgres:your_secure_password_here@localhost:5432/postgres`
- Database already running via Docker Compose (Citus cluster)
- pgvector extension will be enabled as part of setup

## Project Structure
```
./node-app/
├── package.json
├── .env
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx              # React app entry
│   ├── App.tsx               # Main React component
│   ├── components/           # React components
│   │   ├── SearchBox.tsx     # Search UI component
│   │   └── ResultsList.tsx   # Results display component
│   └── api.ts                # Frontend API client
├── server/
│   ├── index.ts              # Hono server entry
│   └── routes.ts             # API routes
└── db/
    ├── client.ts             # Database connection
    ├── schema.ts             # Drizzle schema definitions
    └── migrations/           # Database migrations
```

## Implementation Phases

### Phase 1: Project Setup
**Goal**: Initialize the project with all necessary dependencies

#### 1.1 Initialize Node.js project
- [ ] Create `package.json` with project metadata
- [ ] Add TypeScript configuration
- [ ] Configure ESM modules

#### 1.2 Install Core Dependencies
```json
{
  "dependencies": {
    "drizzle-orm": "^0.43.1",
    "postgres": "^3.3.4",
    "hono": "latest",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "drizzle-kit": "latest",
    "typescript": "^5",
    "vite": "latest",
    "@vitejs/plugin-react": "latest",
    "tsx": "latest"
  }
}
```

#### 1.3 Setup Environment Configuration
- [ ] Create `.env` file with DATABASE_URL
- [ ] Create `.env.example` for reference
- [ ] Add `.env` to `.gitignore`

**Test**: Verify all dependencies install without errors

---

### Phase 2: Database Layer Setup (TDD)
**Goal**: Set up Drizzle ORM with pgvector schema

#### 2.1 Create Database Client
**File**: `db/client.ts`
- [ ] Write test: Verify database connection succeeds
- [ ] Import `postgres` client
- [ ] Create connection using DATABASE_URL
- [ ] Export drizzle instance
- [ ] Test connection

**Test**: Connection establishes successfully

#### 2.2 Define Chunks Schema
**File**: `db/schema.ts`
- [ ] Import pgvector types from `drizzle-orm/pg-core`
- [ ] Define `chunks` table with:
  - `id`: serial primary key
  - `content`: text (the actual text content)
  - `embedding`: vector(1536) (OpenAI embedding dimensions)
  - `created_at`: timestamp with default
- [ ] Export schema

**Test**: Schema type-checks correctly

#### 2.3 Create Migration for Vector Extension and Table
**File**: `db/migrations/0001_init.sql`
- [ ] Write test: Check extension exists after migration
- [ ] Add `CREATE EXTENSION IF NOT EXISTS vector`
- [ ] Add `CREATE TABLE chunks` with all columns
- [ ] Add index: `CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops)`

**File**: `drizzle.config.ts`
- [ ] Configure drizzle-kit for migrations
- [ ] Set schema path
- [ ] Set migrations directory
- [ ] Configure postgres connection

**Test**: Run migration and verify table exists with correct schema

#### 2.4 Seed Test Data
**File**: `db/seed.ts`
- [ ] Write test: Verify seed inserts correct number of rows
- [ ] Create sample chunks with mock embeddings (random vectors)
- [ ] Insert 10-20 test records
- [ ] Verify insertion

**Test**: Database contains seed data after running seed script

---

### Phase 3: Backend API with Hono (TDD)
**Goal**: Create API endpoints for vector search

#### 3.1 Setup Hono Server
**File**: `server/index.ts`
- [ ] Write test: Server starts and responds to health check
- [ ] Import Hono
- [ ] Create Hono app instance
- [ ] Add CORS middleware
- [ ] Add JSON body parser
- [ ] Setup server listening on port 3000
- [ ] Add health check endpoint: GET `/health`

**Test**: Server starts and GET `/health` returns 200

#### 3.2 Create Vector Search Endpoint
**File**: `server/routes.ts`
- [ ] Write test: Search endpoint returns top K results ordered by distance
- [ ] Import drizzle client and schema
- [ ] Import distance functions: `cosineDistance`, `l2Distance`
- [ ] Create POST `/api/search` endpoint
  - Accept: `{ query: number[], limit?: number }`
  - Validate: query is array of 1536 numbers
  - Query: Use `cosineDistance` for similarity
  - Return: Top K chunks with distance scores

**Test**: POST `/api/search` with mock vector returns correct results

#### 3.3 Create Chunk Insert Endpoint (Optional)
**File**: `server/routes.ts`
- [ ] Write test: Insert endpoint creates new chunk
- [ ] Create POST `/api/chunks` endpoint
  - Accept: `{ content: string, embedding: number[] }`
  - Validate: embedding is array of 1536 numbers
  - Insert into database
  - Return: created chunk with id

**Test**: POST `/api/chunks` successfully inserts and returns chunk

#### 3.4 Integration Test
- [ ] Write test: End-to-end search flow
- [ ] Insert known vectors
- [ ] Search with query vector
- [ ] Verify correct results returned in order
- [ ] Verify distance calculations are correct

**Test**: Complete search flow works end-to-end

---

### Phase 4: React Frontend (TDD)
**Goal**: Build search UI for vector queries

#### 4.1 Setup Vite + React
**File**: `vite.config.ts`
- [ ] Configure Vite for React
- [ ] Setup proxy to backend API (`/api` -> `http://localhost:3000`)
- [ ] Configure build output

**File**: `index.html`
- [ ] Create HTML entry point
- [ ] Add root div
- [ ] Link to main.tsx

**File**: `src/main.tsx`
- [ ] Import React and ReactDOM
- [ ] Render App component to root

**Test**: `npm run dev` starts dev server without errors

#### 4.2 Create API Client
**File**: `src/api.ts`
- [ ] Write test: API client formats requests correctly
- [ ] Create `searchVectors` function
  - Accept: query vector and limit
  - POST to `/api/search`
  - Return: typed response
- [ ] Create `insertChunk` function (optional)
- [ ] Handle errors gracefully

**Test**: Mock fetch calls work correctly

#### 4.3 Build Search Component
**File**: `src/components/SearchBox.tsx`
- [ ] Write test: Component renders input field
- [ ] Write test: Submit triggers search callback
- [ ] Create controlled input for embedding vector (as JSON array)
- [ ] Add submit button
- [ ] Handle form validation
- [ ] Display loading state
- [ ] Handle errors

**Test**: Component renders and triggers callbacks

#### 4.4 Build Results Component
**File**: `src/components/ResultsList.tsx`
- [ ] Write test: Component renders empty state
- [ ] Write test: Component renders results list
- [ ] Accept array of chunks with distances
- [ ] Display each chunk's content
- [ ] Display similarity score
- [ ] Handle empty results

**Test**: Component displays results correctly

#### 4.5 Wire Up Main App
**File**: `src/App.tsx`
- [ ] Write test: App renders without crashing
- [ ] Write test: Search updates results
- [ ] Import SearchBox and ResultsList
- [ ] Manage search state (loading, results, error)
- [ ] Call API on search
- [ ] Pass results to ResultsList
- [ ] Add basic styling

**Test**: Complete UI flow works

---

### Phase 5: Integration & Polish
**Goal**: Ensure everything works together

#### 5.1 End-to-End Testing
- [ ] Start database (already running)
- [ ] Run migrations
- [ ] Seed test data
- [ ] Start backend server
- [ ] Start frontend dev server
- [ ] Manually test search flow
- [ ] Verify results are correct

#### 5.2 Documentation
**File**: `node-app/README.md`
- [ ] Document setup steps
- [ ] Document how to run migrations
- [ ] Document how to seed database
- [ ] Document how to start dev servers
- [ ] Document API endpoints
- [ ] Document environment variables

#### 5.3 Scripts
**File**: `package.json`
- [ ] Add `dev:api` script (run Hono server)
- [ ] Add `dev:ui` script (run Vite dev server)
- [ ] Add `dev` script (run both concurrently)
- [ ] Add `db:generate` script (generate migrations)
- [ ] Add `db:migrate` script (run migrations)
- [ ] Add `db:seed` script (seed database)
- [ ] Add `build` script (build for production)

---

## Technical Decisions

### Why Drizzle ORM?
- Native pgvector support (0.31.0+)
- Type-safe queries
- No need for `pgvector.toSql()` conversions
- Clean integration with PostgreSQL

### Why Hono?
- Lightweight and fast
- Modern TypeScript API
- Easy middleware setup
- Good for small APIs

### Vector Distance Metric
- Using **cosine distance** as default (most common for embeddings)
- Cosine distance operator: `<=>`
- Alternative: L2 distance (`<->`) if needed

### Embedding Dimensions
- Default: 1536 (OpenAI text-embedding-3-small)
- Can be adjusted in schema if using different embedding model

### Index Strategy
- HNSW index on embeddings for fast approximate search
- Operator class: `vector_cosine_ops`
- Create index AFTER initial data load

---

## Success Criteria

1. ✅ Database schema created with vector column
2. ✅ Sample data seeded successfully
3. ✅ API endpoint returns correct search results
4. ✅ Frontend displays search interface
5. ✅ Search returns relevant results ordered by similarity
6. ✅ All tests pass
7. ✅ Application runs without errors

---

## Notes

- **Citus Distribution**: Not using distributed tables initially (single chunks table)
- **Authentication**: None for MVP (add later if needed)
- **Embedding Generation**: Using pre-computed embeddings (not generating on-the-fly)
- **Error Handling**: Basic error handling, improve in production
- **Styling**: Minimal CSS, focus on functionality

---

## Next Steps (Future Enhancements)

- [ ] Add embedding generation API (OpenAI integration)
- [ ] Add text search alongside vector search
- [ ] Implement hybrid search (vector + keyword)
- [ ] Add authentication
- [ ] Add chunk management UI (CRUD)
- [ ] Optimize with pagination
- [ ] Add Citus distribution for scale
- [ ] Add distance threshold filtering
- [ ] Deploy to production
