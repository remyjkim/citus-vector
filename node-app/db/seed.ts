// ABOUTME: Database seed script that populates chunks table with test data.
// ABOUTME: Generates random embeddings (both OpenAI and local) for testing dual embedding search.
import 'dotenv/config';
import { db, sql as pgSql } from './client.js';
import { chunks } from './schema.js';

function generateRandomEmbedding(dimensions: number): number[] {
  return Array.from({ length: dimensions }, () => Math.random());
}

const sampleContent = [
  'The quick brown fox jumps over the lazy dog',
  'Machine learning models require large amounts of training data',
  'Vector databases enable semantic search capabilities',
  'PostgreSQL is a powerful relational database',
  'Citus extends PostgreSQL for distributed workloads',
  'React is a popular JavaScript library for building UIs',
  'Hono is a lightweight web framework for the edge',
  'TypeScript adds static typing to JavaScript',
  'Drizzle ORM provides type-safe database queries',
  'pgvector adds vector similarity search to PostgreSQL',
  'HNSW indexes provide fast approximate nearest neighbor search',
  'Embeddings represent text as high-dimensional vectors',
  'Cosine distance is commonly used for semantic similarity',
  'Natural language processing has advanced significantly',
  'Deep learning models can generate high-quality embeddings',
  'Full-text search and vector search complement each other',
  'Distributed systems enable horizontal scaling',
  'Database sharding distributes data across multiple nodes',
  'Vector search is useful for recommendation systems',
  'Semantic search finds meaning beyond keyword matching',
];

async function seedDatabase() {
  console.log('Seeding database with test data...');

  try {
    // Generate chunks with both embedding types
    const newChunks = sampleContent.map((content, index) => ({
      channelId: (index % 3) + 1,
      userId: (index % 5) + 1,
      writerChannelId: index % 2 === 0 ? (index % 3) + 1 : null,
      content,
      embeddingOpenai: generateRandomEmbedding(1536),
      embeddingLocal: generateRandomEmbedding(384),
      embeddingProvider: 'both' as const,
      metadata: {
        category: ['tech', 'database', 'ai'][index % 3],
        importance: (index % 5) + 1,
      },
    }));

    console.log(`Inserting ${newChunks.length} chunks with both OpenAI and local embeddings...`);
    await db.insert(chunks).values(newChunks);

    console.log('Seed completed successfully');
    console.log(`Created ${newChunks.length} chunks with dual embeddings`);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await pgSql.end();
  }
}

seedDatabase();
