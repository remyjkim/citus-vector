// ABOUTME: API route handlers for vector search and chunk management with dual embedding support.
// ABOUTME: OpenAI embeddings generated server-side; local embeddings generated client-side and sent as vectors.
import { Hono } from 'hono';
import { cosineDistance, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chunks, type EmbeddingProvider } from '../db/schema.js';
import { generateEmbedding } from './embeddings/index.js';

const app = new Hono();

app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { text, embedding, provider = 'openai', limit = 5 } = body;

    if (provider !== 'openai' && provider !== 'local') {
      return c.json({ error: 'provider must be "openai" or "local"' }, 400);
    }

    let queryEmbedding: number[];

    if (provider === 'openai') {
      // OpenAI: Server generates embedding from text
      if (!text || typeof text !== 'string') {
        return c.json({ error: 'text is required for OpenAI provider' }, 400);
      }
      const result = await generateEmbedding(text);
      queryEmbedding = result.embedding;

    } else {
      // Local: Client sends pre-computed embedding vector
      if (!embedding || !Array.isArray(embedding)) {
        return c.json({ error: 'embedding array is required for local provider' }, 400);
      }
      if (embedding.length !== 384) {
        return c.json({ error: 'Local embedding must be 384 dimensions' }, 400);
      }
      queryEmbedding = embedding;
    }

    // Select appropriate embedding column based on provider
    const embeddingColumn = provider === 'openai'
      ? chunks.embeddingOpenai
      : chunks.embeddingLocal;

    // Search only chunks that have the selected embedding type
    const results = await db
      .select()
      .from(chunks)
      .where(isNotNull(embeddingColumn))
      .orderBy(cosineDistance(embeddingColumn, queryEmbedding))
      .limit(Number(limit));

    return c.json({ results, provider });
  } catch (error) {
    console.error('Search error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    return c.json({ error: message }, 500);
  }
});

app.post('/chunks', async (c) => {
  try {
    const body = await c.req.json();
    const { channelId, userId, writerChannelId, content, embeddingOpenai, embeddingLocal, embeddingProvider = 'openai', metadata } = body;

    if (!channelId || !userId || !content) {
      return c.json({ error: 'Missing required fields: channelId, userId, content' }, 400);
    }

    // Validate embeddings if provided
    if (embeddingOpenai && (!Array.isArray(embeddingOpenai) || embeddingOpenai.length !== 1536)) {
      return c.json({ error: 'embeddingOpenai must be an array of 1536 numbers' }, 400);
    }

    if (embeddingLocal && (!Array.isArray(embeddingLocal) || embeddingLocal.length !== 384)) {
      return c.json({ error: 'embeddingLocal must be an array of 384 numbers' }, 400);
    }

    if (!embeddingOpenai && !embeddingLocal) {
      return c.json({ error: 'At least one embedding (embeddingOpenai or embeddingLocal) must be provided' }, 400);
    }

    const result = await db
      .insert(chunks)
      .values({
        channelId,
        userId,
        writerChannelId,
        content,
        embeddingOpenai,
        embeddingLocal,
        embeddingProvider,
        metadata,
      })
      .returning();

    return c.json({ chunk: result[0] }, 201);
  } catch (error) {
    console.error('Insert error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create chunk';
    return c.json({ error: message }, 500);
  }
});

app.post('/embed', async (c) => {
  try {
    const body = await c.req.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'text is required and must be a string' }, 400);
    }

    // Only OpenAI embeddings are generated server-side
    // Local embeddings are generated in the browser
    const result = await generateEmbedding(text);

    return c.json({
      embedding: result.embedding,
      dimensions: result.dimensions,
      provider: result.provider
    });
  } catch (error) {
    console.error('Embedding error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate embedding';
    return c.json({ error: message }, 500);
  }
});

app.post('/chunks/upsert', async (c) => {
  try {
    const body = await c.req.json();
    const { text, channelId, userId, writerChannelId, metadata, id, provider = 'openai', embeddingLocal: clientEmbeddingLocal } = body;

    if (!text || !channelId || !userId) {
      return c.json({ error: 'text, channelId, and userId are required' }, 400);
    }

    if (typeof text !== 'string') {
      return c.json({ error: 'text must be a string' }, 400);
    }

    if (provider !== 'openai' && provider !== 'local' && provider !== 'both') {
      return c.json({ error: 'provider must be "openai", "local", or "both"' }, 400);
    }

    // Generate/collect embeddings based on provider
    let embeddingOpenai: number[] | undefined;
    let embeddingLocal: number[] | undefined;
    let actualProvider: EmbeddingProvider;

    if (provider === 'openai' || provider === 'both') {
      const result = await generateEmbedding(text);
      embeddingOpenai = result.embedding;
    }

    if (provider === 'local' || provider === 'both') {
      // Client must provide local embedding
      if (!clientEmbeddingLocal || !Array.isArray(clientEmbeddingLocal) || clientEmbeddingLocal.length !== 384) {
        return c.json({ error: 'Valid 384-dim embeddingLocal required for local/both provider' }, 400);
      }
      embeddingLocal = clientEmbeddingLocal;
    }

    actualProvider = provider;

    const chunkData = {
      channelId,
      userId,
      writerChannelId,
      content: text,
      embeddingOpenai,
      embeddingLocal,
      embeddingProvider: actualProvider,
      metadata,
    };

    if (id) {
      const result = await db
        .insert(chunks)
        .values({
          id,
          ...chunkData,
        })
        .onConflictDoUpdate({
          target: [chunks.id, chunks.channelId],
          set: chunkData,
        })
        .returning();

      return c.json({ chunk: result[0], action: 'upserted' });
    } else {
      const result = await db
        .insert(chunks)
        .values(chunkData)
        .returning();

      return c.json({ chunk: result[0], action: 'created' }, 201);
    }
  } catch (error) {
    console.error('Upsert error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upsert chunk';
    return c.json({ error: message }, 500);
  }
});

export default app;
