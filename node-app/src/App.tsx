// ABOUTME: Main React application component coordinating search UI and results display.
// ABOUTME: Manages search state and orchestrates communication between components and API.
import { useState } from 'react';
import SearchBox from './components/SearchBox';
import ResultsList from './components/ResultsList';
import { searchVectors, Chunk } from './api';

export default function App() {
  const [results, setResults] = useState<Chunk[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: number[]) => {
    setIsLoading(true);
    setError(null);

    try {
      const searchResults = await searchVectors(query, 5);
      setResults(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
      <h1>Citus Vector Search</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Search through distributed chunks using pgvector semantic similarity
      </p>

      <SearchBox onSearch={handleSearch} isLoading={isLoading} />
      <ResultsList results={results} isLoading={isLoading} error={error} />
    </div>
  );
}
