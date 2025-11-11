// ABOUTME: Tests for API routes including bulk upsert functionality.
// ABOUTME: Tests validate server-side OpenAI embedding generation, client-side local embeddings, and graceful error handling.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db } from '../db/client.js';
import { chunks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import app from './routes.js';

describe('Bulk Upsert API', () => {
  const testChannelId = 99999;
  const testUserId = 88888;

  // Clean up test data before and after tests
  before(async () => {
    await db.delete(chunks).where(eq(chunks.channelId, testChannelId));
  });

  after(async () => {
    await db.delete(chunks).where(eq(chunks.channelId, testChannelId));
  });

  it('should bulk upsert chunks with OpenAI provider (server-side embeddings)', async () => {
    const payload = {
      provider: 'openai',
      chunks: [
        {
          text: 'First test chunk for OpenAI',
          channelId: testChannelId,
          userId: testUserId,
          writerChannelId: 11111,
        },
        {
          text: 'Second test chunk for OpenAI',
          channelId: testChannelId,
          userId: testUserId,
          writerChannelId: 11111,
        },
      ],
    };

    const req = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await app.request(req);
    assert.strictEqual(response.status, 200, 'Should return 200 status');

    const result = await response.json();
    assert.ok(result.results, 'Should have results array');
    assert.strictEqual(result.results.length, 2, 'Should process 2 chunks');
    assert.strictEqual(result.successCount, 2, 'Should have 2 successes');
    assert.strictEqual(result.errorCount, 0, 'Should have 0 errors');

    // Verify embeddings were generated server-side
    result.results.forEach((item: any) => {
      assert.ok(item.success, 'Each item should be successful');
      assert.ok(item.chunk, 'Each item should have chunk data');
      assert.ok(item.chunk.embeddingOpenai, 'Should have OpenAI embedding');
      assert.strictEqual(item.chunk.embeddingOpenai.length, 1536, 'OpenAI embedding should be 1536 dimensions');
      assert.strictEqual(item.chunk.embeddingLocal, null, 'Should not have local embedding');
    });
  });

  it('should bulk upsert chunks with local provider (client-provided embeddings)', async () => {
    const mockLocalEmbedding = new Array(384).fill(0.1);

    const payload = {
      provider: 'local',
      chunks: [
        {
          text: 'First test chunk for local',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
        {
          text: 'Second test chunk for local',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
      ],
    };

    const req = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await app.request(req);
    assert.strictEqual(response.status, 200, 'Should return 200 status');

    const result = await response.json();
    assert.strictEqual(result.successCount, 2, 'Should have 2 successes');

    result.results.forEach((item: any) => {
      assert.ok(item.success, 'Each item should be successful');
      assert.ok(item.chunk.embeddingLocal, 'Should have local embedding');
      assert.strictEqual(item.chunk.embeddingLocal.length, 384, 'Local embedding should be 384 dimensions');
      assert.strictEqual(item.chunk.embeddingOpenai, null, 'Should not have OpenAI embedding');
    });
  });

  it('should bulk upsert chunks with both providers', async () => {
    const mockLocalEmbedding = new Array(384).fill(0.1);

    const payload = {
      provider: 'both',
      chunks: [
        {
          text: 'Test chunk with both embeddings',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
      ],
    };

    const req = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await app.request(req);
    assert.strictEqual(response.status, 200, 'Should return 200 status');

    const result = await response.json();
    assert.strictEqual(result.successCount, 1, 'Should have 1 success');

    const item = result.results[0];
    assert.ok(item.chunk.embeddingOpenai, 'Should have OpenAI embedding');
    assert.ok(item.chunk.embeddingLocal, 'Should have local embedding');
    assert.strictEqual(item.chunk.embeddingProvider, 'both', 'Provider should be "both"');
  });

  it('should handle upsert behavior with composite key (id + channelId)', async () => {
    // First, create a chunk
    const mockLocalEmbedding = new Array(384).fill(0.1);

    const createPayload = {
      provider: 'local',
      chunks: [
        {
          text: 'Original content',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
      ],
    };

    const createReq = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });

    const createResponse = await app.request(createReq);
    const createResult = await createResponse.json();
    const createdChunk = createResult.results[0].chunk;
    assert.ok(createdChunk.id, 'Should have generated ID');
    assert.strictEqual(createResult.results[0].action, 'created', 'Action should be "created"');

    // Now upsert with the same id and channelId to update
    const updatePayload = {
      provider: 'local',
      chunks: [
        {
          id: createdChunk.id,
          text: 'Updated content',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
      ],
    };

    const updateReq = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload),
    });

    const updateResponse = await app.request(updateReq);
    const updateResult = await updateResponse.json();
    const updatedChunk = updateResult.results[0].chunk;

    assert.strictEqual(updatedChunk.id, createdChunk.id, 'ID should remain the same');
    assert.strictEqual(updatedChunk.content, 'Updated content', 'Content should be updated');
    assert.strictEqual(updateResult.results[0].action, 'upserted', 'Action should be "upserted"');
  });

  it('should gracefully handle partial failures', async () => {
    const mockLocalEmbedding = new Array(384).fill(0.1);

    const payload = {
      provider: 'local',
      chunks: [
        {
          text: 'Valid chunk',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
        {
          text: 'Invalid chunk - missing userId',
          channelId: testChannelId,
          // userId missing intentionally
          embeddingLocal: mockLocalEmbedding,
        },
        {
          text: 'Another valid chunk',
          channelId: testChannelId,
          userId: testUserId,
          embeddingLocal: mockLocalEmbedding,
        },
      ],
    };

    const req = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await app.request(req);
    assert.strictEqual(response.status, 200, 'Should return 200 even with partial failures');

    const result = await response.json();
    assert.strictEqual(result.successCount, 2, 'Should have 2 successes');
    assert.strictEqual(result.errorCount, 1, 'Should have 1 error');
    assert.strictEqual(result.results.length, 3, 'Should have 3 result items');

    const failedItem = result.results[1];
    assert.strictEqual(failedItem.success, false, 'Middle item should fail');
    assert.ok(failedItem.error, 'Failed item should have error message');
  });

  it('should validate provider parameter', async () => {
    const payload = {
      provider: 'invalid',
      chunks: [
        {
          text: 'Test',
          channelId: testChannelId,
          userId: testUserId,
        },
      ],
    };

    const req = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await app.request(req);
    assert.strictEqual(response.status, 400, 'Should return 400 for invalid provider');
    const result = await response.json();
    assert.ok(result.error, 'Should have error message');
  });

  it('should validate required embeddingLocal for local/both providers', async () => {
    const payload = {
      provider: 'local',
      chunks: [
        {
          text: 'Test without embedding',
          channelId: testChannelId,
          userId: testUserId,
          // embeddingLocal missing
        },
      ],
    };

    const req = new Request('http://localhost/chunks/bulk-upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await app.request(req);
    assert.strictEqual(response.status, 200, 'Should return 200 (graceful handling)');
    const result = await response.json();
    assert.strictEqual(result.errorCount, 1, 'Should have 1 error');
    assert.strictEqual(result.results[0].success, false, 'Item should fail');
  });
});
