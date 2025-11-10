// ABOUTME: Client-side embedding generation using Xenova/transformers in browser.
// ABOUTME: Model cached in browser (Cache API + IndexedDB) for fast subsequent loads.
import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

// Configure transformers.js for browser usage with caching
// Models are automatically cached in browser's Cache API + IndexedDB
env.allowLocalModels = false; // Use CDN models
env.allowRemoteModels = true;

let embedder: FeatureExtractionPipeline | null = null;
let loading = false;
let loadError: Error | null = null;
let loadProgress = 0;

export interface ModelLoadProgress {
  status: 'loading' | 'ready' | 'error';
  progress: number; // 0-100
  message: string;
}

type ProgressCallback = (progress: ModelLoadProgress) => void;
let progressCallbacks: ProgressCallback[] = [];

/**
 * Subscribe to model loading progress updates
 * @param callback Function called with progress updates
 * @returns Unsubscribe function
 */
export function onModelLoadProgress(callback: ProgressCallback): () => void {
  progressCallbacks.push(callback);

  // If model is already loaded or failed, call immediately
  if (embedder) {
    callback({ status: 'ready', progress: 100, message: 'Model ready' });
  } else if (loadError) {
    callback({ status: 'error', progress: 0, message: loadError.message });
  } else if (loading) {
    callback({ status: 'loading', progress: loadProgress, message: 'Loading model...' });
  }

  // Return unsubscribe function
  return () => {
    progressCallbacks = progressCallbacks.filter(cb => cb !== callback);
  };
}

function notifyProgress(update: ModelLoadProgress) {
  loadProgress = update.progress;
  progressCallbacks.forEach(cb => cb(update));
}

/**
 * Initialize the local embedding model (all-MiniLM-L6-v2)
 * Model is automatically cached in browser's IndexedDB/Cache API
 * Subsequent loads will be instant
 * @returns Promise that resolves when model is loaded
 */
export async function initClientEmbeddings(): Promise<FeatureExtractionPipeline> {
  if (embedder) {
    return embedder;
  }

  if (loadError) {
    throw loadError;
  }

  if (loading) {
    // Wait for existing load operation
    while (loading && !embedder && !loadError) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (embedder) return embedder;
    if (loadError) throw loadError;
  }

  loading = true;
  notifyProgress({ status: 'loading', progress: 0, message: 'Initializing model...' });

  try {
    console.log('[Client Embeddings] Loading all-MiniLM-L6-v2 model...');
    notifyProgress({ status: 'loading', progress: 10, message: 'Downloading model (23MB, first time only)...' });

    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      {
        // Progress callback for download
        progress_callback: (data: any) => {
          if (data.status === 'progress' && data.progress) {
            const progress = Math.round(10 + (data.progress * 80)); // 10-90%
            notifyProgress({
              status: 'loading',
              progress,
              message: `Downloading model: ${progress}%`
            });
          } else if (data.status === 'done') {
            notifyProgress({ status: 'loading', progress: 95, message: 'Initializing...' });
          }
        }
      }
    );

    console.log('[Client Embeddings] Model loaded successfully');
    console.log('[Client Embeddings] Model cached in browser - subsequent loads will be instant');
    notifyProgress({ status: 'ready', progress: 100, message: 'Model ready' });

    return embedder;
  } catch (error) {
    loadError = error instanceof Error ? error : new Error('Failed to load embedding model');
    console.error('[Client Embeddings] Model loading failed:', error);
    notifyProgress({ status: 'error', progress: 0, message: loadError.message });
    throw loadError;
  } finally {
    loading = false;
  }
}

/**
 * Generate 384-dimensional embedding vector for given text using local model
 * @param text Input text to embed
 * @returns Promise resolving to 384-dimensional embedding vector
 */
export async function generateClientEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }

  const model = await initClientEmbeddings();

  try {
    const output = await model(text, {
      pooling: 'mean',
      normalize: true
    });

    // Convert tensor to array
    const embedding = Array.from(output.data as Float32Array);

    // Verify dimensions
    if (embedding.length !== 384) {
      throw new Error(`Expected 384 dimensions, got ${embedding.length}`);
    }

    return embedding;
  } catch (error) {
    console.error('[Client Embeddings] Embedding generation failed:', error);
    throw error instanceof Error ? error : new Error('Failed to generate embedding');
  }
}

/**
 * Check if client embedding model is ready
 * @returns true if model is loaded and ready
 */
export function isClientEmbeddingsReady(): boolean {
  return embedder !== null;
}

/**
 * Get client embedding dimensions
 * @returns 384 (dimension count for all-MiniLM-L6-v2)
 */
export function getClientEmbeddingDimensions(): number {
  return 384;
}

/**
 * Clear the loaded model from memory (not from cache)
 * Cache in IndexedDB/Cache API persists
 */
export function clearClientEmbeddings(): void {
  embedder = null;
  loading = false;
  loadError = null;
  console.log('[Client Embeddings] Model cleared from memory (cache persists)');
}
