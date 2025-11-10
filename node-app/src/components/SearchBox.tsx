// ABOUTME: Search input component for entering vector embeddings to query.
// ABOUTME: Accepts JSON array input and triggers search callback on submission.
import { useState, FormEvent } from 'react';

interface SearchBoxProps {
  onSearch: (query: number[]) => void;
  isLoading: boolean;
}

export default function SearchBox({ onSearch, isLoading }: SearchBoxProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const parsed = JSON.parse(input);

      if (!Array.isArray(parsed)) {
        setError('Input must be a JSON array');
        return;
      }

      if (parsed.length !== 1536) {
        setError('Array must contain exactly 1536 numbers');
        return;
      }

      if (!parsed.every((n) => typeof n === 'number')) {
        setError('All elements must be numbers');
        return;
      }

      onSearch(parsed);
    } catch (err) {
      setError('Invalid JSON format');
    }
  };

  const loadRandomVector = () => {
    const randomVector = Array.from({ length: 1536 }, () => Math.random());
    setInput(JSON.stringify(randomVector));
    setError(null);
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2>Vector Search</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="vector-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Enter embedding vector (JSON array of 1536 numbers):
          </label>
          <textarea
            id="vector-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='[0.1, 0.2, 0.3, ...]'
            rows={6}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              padding: '0.5rem',
            }}
          />
        </div>

        {error && (
          <div style={{ color: 'red', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              padding: '0.5rem 1rem',
              background: isLoading ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>

          <button
            type="button"
            onClick={loadRandomVector}
            style={{
              padding: '0.5rem 1rem',
              background: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Generate Random Vector
          </button>
        </div>
      </form>
    </div>
  );
}
