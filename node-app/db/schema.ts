// ABOUTME: Drizzle ORM schema definitions for chunks table with pgvector support.
// ABOUTME: Defines distributed chunks table with channel/user organization and vector embeddings.
import { pgTable, bigserial, bigint, text, vector, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core';

export const chunks = pgTable('chunks', {
  id: bigserial('id', { mode: 'number' }).notNull(),
  channelId: bigint('channel_id', { mode: 'number' }).notNull(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  writerChannelId: bigint('writer_channel_id', { mode: 'number' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.channelId] })
}));

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
