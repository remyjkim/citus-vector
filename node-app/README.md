# Citus Vector Search Application

A vector similarity search application built with Drizzle ORM, Hono, React, and pgvector on a Citus distributed PostgreSQL cluster.

## Architecture

- **Backend**: Hono API server (port 3000)
- **Frontend**: React + Vite (port 5173)
- **Database**: PostgreSQL with Citus + pgvector extensions
- **ORM**: Drizzle ORM with type-safe queries

## Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL with Citus and pgvector extensions running at `DATABASE_URL`

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Create `.env` file (or use existing):

```bash
DATABASE_URL=postgresql://postgres:your_secure_password_here@localhost:5432/postgres
```

### 3. Database Setup

Run these commands in order:

```bash
# Run migrations (creates chunks table)
pnpm db:migrate

# Configure Citus distribution and create indexes
pnpm db:setup-citus

# Seed database with test data
pnpm db:seed
```

**Note**: The database must already have the `vector` extension installed. If not, run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citus;
```

## Development

### Run Both Servers Concurrently

```bash
pnpm dev
```

This starts:
- API server on `http://localhost:3000`
- UI dev server on `http://localhost:5173`

### Run Servers Separately

```bash
# API only
pnpm dev:api

# UI only
pnpm dev:ui
```

## API Endpoints

### POST /api/search

Search chunks by vector similarity.

**Request:**
```json
{
  "query": [0.1, 0.2, ...],  // Array of 1536 numbers
  "limit": 5                  // Optional, defaults to 5
}
```

**Response:**
```json
{
  "results": [
    {
      "id": 1,
      "channelId": 1,
      "userId": 1,
      "writerChannelId": null,
      "content": "Sample text",
      "embedding": [...],
      "metadata": {"category": "tech"},
      "createdAt": "2025-11-10T..."
    }
  ]
}
```

### POST /api/chunks

Create a new chunk.

**Request:**
```json
{
  "channelId": 1,
  "userId": 1,
  "writerChannelId": null,
  "content": "Text content",
  "embedding": [0.1, 0.2, ...],  // Array of 1536 numbers
  "metadata": {"key": "value"}
}
```

### GET /health

Health check endpoint.

## Database Schema

### Chunks Table

Distributed by `channel_id` for optimal query routing.

```sql
CREATE TABLE chunks (
  id bigserial NOT NULL,
  channel_id bigint NOT NULL,
  user_id bigint NOT NULL,
  writer_channel_id bigint,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb,
  created_at timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY (id, channel_id)
);
```

**Indexes:**
- HNSW index on `embedding` for fast vector similarity search
- B-tree index on `user_id`
- B-tree index on `created_at`
- GIN index on `metadata` (when not null)

## Project Structure

```
node-app/
├── db/
│   ├── client.ts           # Database connection
│   ├── schema.ts           # Drizzle schema definitions
│   ├── migrate.ts          # Migration runner
│   ├── setup-citus.ts      # Citus configuration
│   ├── seed.ts             # Test data seeder
│   └── migrations/         # SQL migration files
├── server/
│   ├── index.ts            # Hono server entry point
│   └── routes.ts           # API route handlers
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Main App component
│   ├── api.ts              # API client
│   └── components/
│       ├── SearchBox.tsx   # Search input component
│       └── ResultsList.tsx # Results display component
├── package.json
├── tsconfig.json
├── vite.config.ts
└── drizzle.config.ts
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run both API and UI concurrently |
| `pnpm dev:api` | Run API server only |
| `pnpm dev:ui` | Run UI dev server only |
| `pnpm db:generate` | Generate new migration from schema changes |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:setup-citus` | Configure Citus distribution and indexes |
| `pnpm db:seed` | Seed database with test data |
| `pnpm build` | Build for production |
| `pnpm test` | Run tests |

## Usage

1. Start the development servers: `pnpm dev`
2. Open `http://localhost:5173` in your browser
3. Click "Generate Random Vector" to create a test embedding
4. Click "Search" to find similar chunks
5. View results ordered by cosine similarity

## Technical Details

### Vector Search

- Uses **cosine distance** for similarity (most common for embeddings)
- HNSW index provides fast approximate nearest neighbor search
- 1536 dimensions (compatible with OpenAI embeddings)

### Citus Distribution

- Table distributed by `channel_id` for optimal query routing
- Composite primary key `(id, channel_id)` required for distributed tables
- Indexes created on each shard automatically

### Performance Configuration

The `setup-citus.ts` script configures these database-level settings:

- `hnsw.ef_search = 200` - HNSW query tuning (higher = better recall)
- `maintenance_work_mem = 2GB` - Memory for index building
- `max_parallel_workers_per_gather = 4` - Parallel query execution

**Important**: Reconnect to database after running `db:setup-citus` for settings to take effect.

## Notes

- pgvector extension must be installed in the database
- Citus extension must be installed for distributed tables
- Embeddings are stored as `vector(1536)` type
- Frontend uses Vite proxy to avoid CORS issues in development

## Next Steps

- [ ] Add embedding generation (OpenAI API integration)
- [ ] Add pagination for large result sets
- [ ] Implement hybrid search (vector + full-text)
- [ ] Add authentication
- [ ] Add chunk management UI (CRUD operations)
- [ ] Deploy to production
