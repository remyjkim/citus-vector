// ABOUTME: Frontend API client for making requests to the Hono backend.
// ABOUTME: Provides type-safe functions for vector search and chunk operations.

export interface Chunk {
  id: number;
  channelId: number;
  userId: number;
  writerChannelId: number | null;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface SearchResponse {
  results: Chunk[];
}

export interface SearchRequest {
  text: string;
  limit?: number;
}

export async function searchVectors(text: string, limit: number = 5): Promise<Chunk[]> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, limit }),
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
