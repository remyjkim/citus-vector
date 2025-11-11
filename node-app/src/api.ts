// ABOUTME: Frontend API client for making requests to the Hono backend.
// ABOUTME: Supports dual embedding providers - OpenAI (server-side) and local (client-side).

export type EmbeddingProvider = 'openai' | 'local' | 'both';

export interface Chunk {
  id: number;
  channelId: number;
  userId: number;
  writerChannelId: number | null;
  content: string;
  embeddingOpenai?: number[];
  embeddingLocal?: number[];
  embeddingProvider?: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface SearchResponse {
  results: Chunk[];
  provider: EmbeddingProvider;
}

export interface SearchRequest {
  text?: string;
  embedding?: number[];
  provider: EmbeddingProvider;
  limit?: number;
}

/**
 * Search for chunks using vector similarity
 * @param text Query text (required for OpenAI, ignored for local)
 * @param provider Embedding provider: 'openai' (server-side) or 'local' (client-side)
 * @param embedding Pre-computed embedding vector (required for local provider)
 * @param limit Number of results to return
 * @returns Promise resolving to array of matching chunks
 */
export async function searchVectors(
  text: string,
  provider: EmbeddingProvider,
  embedding?: number[],
  limit: number = 5
): Promise<Chunk[]> {
  const body: SearchRequest = {
    provider,
    limit
  };

  if (provider === 'openai') {
    body.text = text;
  } else {
    // Local provider: client sends pre-computed embedding
    if (!embedding || embedding.length !== 384) {
      throw new Error('Valid 384-dim embedding required for local provider');
    }
    body.embedding = embedding;
  }

  const response = await fetch('/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Search failed');
  }

  const data: SearchResponse = await response.json();
  return data.results;
}

export interface CreateChunkRequest {
  channelId: number;
  userId: number;
  writerChannelId?: number | null;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown> | null;
}

export async function createChunk(chunk: CreateChunkRequest): Promise<Chunk> {
  const response = await fetch('/api/chunks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chunk),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create chunk');
  }

  const data = await response.json();
  return data.chunk;
}

export interface UpsertChunkRequest {
  id?: number;
  text: string;
  channelId: number;
  userId: number;
  writerChannelId?: number | null;
  provider: EmbeddingProvider;
  embeddingLocal?: number[];
  metadata?: Record<string, unknown> | null;
}

export interface UpsertChunkResponse {
  chunk: Chunk;
  action: 'created' | 'upserted';
}

export async function upsertChunk(request: UpsertChunkRequest): Promise<UpsertChunkResponse> {
  const response = await fetch('/api/chunks/upsert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to upsert chunk');
  }

  return await response.json();
}

export interface BulkUpsertChunkItem {
  id?: number;
  text: string;
  channelId: number;
  userId: number;
  writerChannelId?: number | null;
  embeddingLocal?: number[];
  metadata?: Record<string, unknown> | null;
}

export interface BulkUpsertRequest {
  provider: EmbeddingProvider;
  chunks: BulkUpsertChunkItem[];
}

export interface BulkUpsertResult {
  success: boolean;
  chunk?: Chunk;
  error?: string;
  action?: 'created' | 'upserted';
}

export interface BulkUpsertResponse {
  results: BulkUpsertResult[];
  successCount: number;
  errorCount: number;
  total: number;
}

export async function bulkUpsertChunks(request: BulkUpsertRequest): Promise<BulkUpsertResponse> {
  const response = await fetch('/api/chunks/bulk-upsert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to bulk upsert chunks');
  }

  return await response.json();
}
