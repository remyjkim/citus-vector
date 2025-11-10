// ABOUTME: OpenAI embedding generation using text-embedding-3-small model.
// ABOUTME: Generates 1536-dimensional embeddings via OpenAI API with error handling and retry logic.
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate embedding vector for given text using OpenAI API
 * @param text Input text to embed
 * @param retries Number of retry attempts for transient failures
 * @returns Promise resolving to 1536-dimensional embedding vector
 */
export async function generateOpenAIEmbedding(
  text: string,
  retries: number = 2
): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });

      const embedding = response.data[0].embedding;

      // Verify dimensions
      if (embedding.length !== 1536) {
        throw new Error(`Expected 1536 dimensions, got ${embedding.length}`);
      }

      return embedding;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to generate OpenAI embedding');

      // Check if error is retryable
      const isRetryable = error instanceof Error &&
        (error.message.includes('rate limit') ||
         error.message.includes('timeout') ||
         error.message.includes('503') ||
         error.message.includes('429'));

      if (isRetryable && attempt < retries) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`OpenAI API error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable error or max retries exceeded
      break;
    }
  }

  console.error('OpenAI embedding generation failed after retries:', lastError);
  throw lastError || new Error('Failed to generate OpenAI embedding');
}

/**
 * Check if OpenAI API is configured
 * @returns true if OPENAI_API_KEY is set
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Get OpenAI embedding dimensions
 * @returns 1536 (dimension count for text-embedding-3-small)
 */
export function getOpenAIEmbeddingDimensions(): number {
  return 1536;
}
