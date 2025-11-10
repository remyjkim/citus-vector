// ABOUTME: Server-side embedding service for OpenAI embeddings only.
// ABOUTME: Local embeddings are generated client-side in the browser using @xenova/transformers.
import { generateOpenAIEmbedding, getOpenAIEmbeddingDimensions, isOpenAIConfigured } from './openai-embeddings.js';
import type { EmbeddingProvider } from '../../db/schema.js';

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  provider: 'openai';
}

/**
 * Generate OpenAI embedding for given text
 * Local embeddings are generated client-side, not on the server
 * @param text Input text to embed
 * @returns Promise resolving to embedding result with vector and metadata
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  if (!isOpenAIConfigured()) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  try {
    const embedding = await generateOpenAIEmbedding(text);
    return {
      embedding,
      dimensions: getOpenAIEmbeddingDimensions(),
      provider: 'openai'
    };
  } catch (error) {
    console.error('OpenAI embedding generation failed:', error);
    throw error instanceof Error ? error : new Error('Failed to generate OpenAI embedding');
  }
}

/**
 * Initialize embedding services
 * Checks OpenAI API configuration on server startup
 * @returns Promise that resolves when initialization checks are complete
 */
export async function initEmbeddingServices(): Promise<void> {
  console.log('Initializing embedding services...');

  if (isOpenAIConfigured()) {
    console.log('✓ OpenAI embeddings configured (server-side)');
  } else {
    console.warn('⚠ OpenAI embeddings not configured (OPENAI_API_KEY not set)');
  }

  console.log('ℹ Local embeddings: client-side only (@xenova/transformers in browser)');
  console.log('Embedding services initialization complete');
}

// Re-export types and utilities
export type { EmbeddingProvider };
export { getOpenAIEmbeddingDimensions };
