// ABOUTME: Search input component with dual embedding provider support.
// ABOUTME: Allows users to choose between OpenAI (server-side) and local (browser-based) embeddings.
import { useState, useEffect, FormEvent } from 'react';
import { initClientEmbeddings, onModelLoadProgress, type ModelLoadProgress } from '../embeddings/client-embeddings';
import type { EmbeddingProvider } from '../api';

interface SearchBoxProps {
  onSearch: (text: string, provider: EmbeddingProvider) => void;
  isLoading: boolean;
}

export default function SearchBox({ onSearch, isLoading }: SearchBoxProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<EmbeddingProvider>('openai');
  const [modelStatus, setModelStatus] = useState<ModelLoadProgress>({
    status: 'loading',
    progress: 0,
    message: 'Not loaded'
  });

  // Initialize local model when provider is switched to 'local'
  useEffect(() => {
    if (provider === 'local') {
      // Subscribe to model loading progress
      const unsubscribe = onModelLoadProgress((progress) => {
        setModelStatus(progress);
      });

      // Start loading the model
      initClientEmbeddings().catch((err) => {
        console.error('Failed to load local model:', err);
      });

      return unsubscribe;
    }
  }, [provider]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!input.trim()) {
      setError('Please enter a search query');
      return;
    }

    // Check if local model is ready
    if (provider === 'local' && modelStatus.status !== 'ready') {
      setError('Local model is still loading. Please wait...');
      return;
    }

    onSearch(input.trim(), provider);
  };

  const sampleQueries = [
    'distributed database systems',
    'vector similarity search',
    'machine learning embeddings',
    'PostgreSQL performance',
  ];

  const loadSampleQuery = (query: string) => {
    setInput(query);
    setError(null);
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2>Semantic Vector Search</h2>
      <form onSubmit={handleSubmit}>
        {/* Embedding Provider Selection */}
        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8f9fa', borderRadius: '4px' }}>
          <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 'bold' }}>
            Embedding Provider:
          </label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                value="openai"
                checked={provider === 'openai'}
                onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
                disabled={isLoading}
                style={{ marginRight: '0.5rem' }}
              />
              <div>
                <strong>OpenAI</strong>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  1536-dim, server-side, high quality
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                value="local"
                checked={provider === 'local'}
                onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
                disabled={isLoading}
                style={{ marginRight: '0.5rem' }}
              />
              <div>
                <strong>Local (Browser)</strong>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  384-dim, runs in browser, free
                </div>
              </div>
            </label>
          </div>

          {/* Model Loading Status for Local Provider */}
          {provider === 'local' && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'white', borderRadius: '4px', border: '1px solid #ddd' }}>
              {modelStatus.status === 'loading' && (
                <div>
                  <div style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                    {modelStatus.message}
                  </div>
                  <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${modelStatus.progress}%`,
                        height: '100%',
                        background: '#007bff',
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                    {modelStatus.progress}% - Model cached in browser after first download
                  </div>
                </div>
              )}
              {modelStatus.status === 'ready' && (
                <div style={{ color: '#28a745', fontSize: '0.9rem' }}>
                  ✓ Model ready (cached in browser IndexedDB)
                </div>
              )}
              {modelStatus.status === 'error' && (
                <div style={{ color: '#dc3545', fontSize: '0.9rem' }}>
                  ✗ Error: {modelStatus.message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search Input */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="search-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Enter your search query:
          </label>
          <input
            id="search-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='e.g., "distributed database systems"'
            style={{
              width: '100%',
              fontSize: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
            }}
          />
        </div>

        {error && (
          <div style={{ color: 'red', marginBottom: '1rem', padding: '0.5rem', background: '#fee', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        {/* Search Button */}
        <div style={{ marginBottom: '1rem' }}>
          <button
            type="submit"
            disabled={isLoading || (provider === 'local' && modelStatus.status !== 'ready')}
            style={{
              padding: '0.75rem 1.5rem',
              background: isLoading || (provider === 'local' && modelStatus.status !== 'ready') ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading || (provider === 'local' && modelStatus.status !== 'ready') ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: '500',
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Sample Queries */}
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          <span style={{ marginRight: '0.5rem' }}>Sample queries:</span>
          {sampleQueries.map((query, index) => (
            <button
              key={index}
              type="button"
              onClick={() => loadSampleQuery(query)}
              style={{
                marginRight: '0.5rem',
                marginBottom: '0.5rem',
                padding: '0.25rem 0.5rem',
                background: '#f0f0f0',
                border: '1px solid #ddd',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {query}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
