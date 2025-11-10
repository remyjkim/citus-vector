// ABOUTME: Search input component for entering text queries.
// ABOUTME: Accepts natural language text and triggers semantic search via embeddings.
import { useState, FormEvent } from 'react';

interface SearchBoxProps {
  onSearch: (text: string) => void;
  isLoading: boolean;
}

export default function SearchBox({ onSearch, isLoading }: SearchBoxProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!input.trim()) {
      setError('Please enter a search query');
      return;
    }

    onSearch(input.trim());
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
          <div style={{ color: 'red', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '1rem' }}>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: '0.75rem 1.5rem',
              background: isLoading ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: '500',
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>

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
