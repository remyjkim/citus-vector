// ABOUTME: Drizzle ORM schema definitions for chunks table with pgvector support.
// ABOUTME: Defines distributed chunks table with dual embedding support (OpenAI 1536-dim and local 384-dim).
import { pgTable, bigserial, bigint, text, vector, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core';

export const chunks = pgTable('chunks', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  channelId: bigint('channel_id', { mode: 'number' }).notNull(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  writerChannelId: bigint('writer_channel_id', { mode: 'number' }),
  content: text('content').notNull(),

  // Dual embedding columns - nullable to support chunks with only one embedding type
  embeddingOpenai: vector('embedding_openai', { dimensions: 1536 }),
  embeddingLocal: vector('embedding_local', { dimensions: 384 }),
  embeddingProvider: text('embedding_provider').default('openai'), // 'openai' | 'local' | 'both'

  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.channelId] })
}));

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;

// Embedding provider type for type safety
export type EmbeddingProvider = 'openai' | 'local' | 'both';
