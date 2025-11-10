// ABOUTME: API route handlers for vector search and chunk management.
// ABOUTME: Provides endpoints for searching chunks by vector similarity and retrieving chunk data.
import { Hono } from 'hono';
import { cosineDistance } from 'drizzle-orm';
import OpenAI from 'openai';
import { db } from '../db/client.js';
import { chunks } from '../db/schema.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = new Hono();

app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const { text, limit = 5 } = body;

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'text is required and must be a string' }, 400);
    }

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    const results = await db
      .select()
      .from(chunks)
      .orderBy(cosineDistance(chunks.embedding, queryEmbedding))
      .limit(Number(limit));

    return c.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.post('/chunks', async (c) => {
  try {
    const body = await c.req.json();
    const { channelId, userId, writerChannelId, content, embedding, metadata } = body;

    if (!channelId || !userId || !content || !embedding) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      return c.json({ error: 'Embedding must be an array of 1536 numbers' }, 400);
    }

    const result = await db
      .insert(chunks)
      .values({
        channelId,
        userId,
        writerChannelId,
        content,
        embedding,
        metadata,
      })
      .returning();

    return c.json({ chunk: result[0] }, 201);
  } catch (error) {
    console.error('Insert error:', error);
    return c.json({ error: 'Failed to create chunk' }, 500);
  }
});

app.post('/embed', async (c) => {
  try {
    const body = await c.req.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'Text is required and must be a string' }, 400);
    }

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    const embedding = response.data[0].embedding;

    return c.json({ embedding });
  } catch (error) {
    console.error('Embedding error:', error);
    return c.json({ error: 'Failed to generate embedding' }, 500);
  }
});

app.post('/chunks/upsert', async (c) => {
  try {
    const body = await c.req.json();
    const { text, channelId, userId, writerChannelId, metadata, id } = body;

    if (!text || !channelId || !userId) {
      return c.json({ error: 'text, channelId, and userId are required' }, 400);
    }

    if (typeof text !== 'string') {
      return c.json({ error: 'text must be a string' }, 400);
    }

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    const embedding = embeddingResponse.data[0].embedding;

    if (id) {
      const result = await db
        .insert(chunks)
        .values({
          id,
          channelId,
          userId,
          writerChannelId,
          content: text,
          embedding,
          metadata,
        })
        .onConflictDoUpdate({
          target: [chunks.id, chunks.channelId],
          set: {
            userId,
            writerChannelId,
            content: text,
            embedding,
            metadata,
          },
        })
        .returning();

      return c.json({ chunk: result[0], action: 'upserted' });
    } else {
      const result = await db
        .insert(chunks)
        .values({
          channelId,
          userId,
          writerChannelId,
          content: text,
          embedding,
          metadata,
        })
        .returning();

      return c.json({ chunk: result[0], action: 'created' }, 201);
    }
  } catch (error) {
    console.error('Upsert error:', error);
    return c.json({ error: 'Failed to upsert chunk' }, 500);
  }
});

export default app;
