// ABOUTME: Main React application component coordinating dual embedding search.
// ABOUTME: Handles both OpenAI (server-side) and local (browser-based) embedding generation.
import { useState } from 'react';
import SearchBox from './components/SearchBox';
import ResultsList from './components/ResultsList';
import { searchVectors, Chunk, type EmbeddingProvider } from './api';
import { generateClientEmbedding } from './embeddings/client-embeddings';

export default function App() {
  const [results, setResults] = useState<Chunk[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<EmbeddingProvider>('openai');

  const handleSearch = async (text: string, provider: EmbeddingProvider) => {
    setIsLoading(true);
    setError(null);
    setActiveProvider(provider);

    try {
      let searchResults: Chunk[];

      if (provider === 'local') {
        // Client-side: Generate embedding in browser first
        console.log('[App] Generating client-side embedding...');
        const embedding = await generateClientEmbedding(text);
        console.log('[App] Embedding generated (384-dim), sending to server...');

        // Send pre-computed embedding to server
        searchResults = await searchVectors(text, provider, embedding, 5);
      } else {
        // OpenAI: Server generates embedding
        console.log('[App] Requesting OpenAI embedding from server...');
        searchResults = await searchVectors(text, provider, undefined, 5);
      }

      setResults(searchResults);
      console.log(`[App] Search complete: ${searchResults.length} results using ${provider} provider`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      console.error('[App] Search error:', message);
      setError(message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
      <h1>Citus Vector Search - Dual Embeddings</h1>
      <p style={{ color: '#666', marginBottom: '1rem' }}>
        Search through distributed chunks using pgvector semantic similarity
      </p>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '2rem', padding: '0.75rem', background: '#f8f9fa', borderRadius: '4px' }}>
        <strong>OpenAI:</strong> Server-side text-embedding-3-small (1536-dim) •
        <strong> Local:</strong> Browser-based all-MiniLM-L6-v2 (384-dim, cached in IndexedDB)
      </p>

      <SearchBox onSearch={handleSearch} isLoading={isLoading} />

      {results.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', background: '#e7f3ff', borderRadius: '4px', fontSize: '0.9rem' }}>
          <strong>Active Provider:</strong> {activeProvider === 'openai' ? 'OpenAI (1536-dim)' : 'Local Browser (384-dim)'}
        </div>
      )}

      <ResultsList results={results} isLoading={isLoading} error={error} />
    </div>
  );
}
