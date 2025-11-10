// ABOUTME: Results display component showing chunks found by vector search.
// ABOUTME: Renders chunk content, metadata, and relevance information in a list.
import { Chunk } from '../api';

interface ResultsListProps {
  results: Chunk[];
  isLoading: boolean;
  error: string | null;
}

export default function ResultsList({ results, isLoading, error }: ResultsListProps) {
  if (isLoading) {
    return <div style={{ marginTop: '2rem' }}>Loading results...</div>;
  }

  if (error) {
    return (
      <div style={{ marginTop: '2rem', color: 'red' }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div style={{ marginTop: '2rem', color: '#666' }}>
        No results yet. Enter a vector and search to see results.
      </div>
    );
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Results ({results.length})</h2>
      <div>
        {results.map((chunk, index) => (
          <div
            key={`${chunk.id}-${chunk.channelId}`}
            style={{
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '1rem',
              marginBottom: '1rem',
              background: '#f9f9f9',
            }}
          >
            <div style={{ marginBottom: '0.5rem', color: '#666', fontSize: '0.9rem' }}>
              <strong>Rank #{index + 1}</strong> | ID: {chunk.id} | Channel: {chunk.channelId} | User: {chunk.userId}
            </div>

            <div style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>
              {chunk.content}
            </div>

            {chunk.metadata && (
              <div style={{ fontSize: '0.85rem', color: '#666' }}>
                <strong>Metadata:</strong>{' '}
                {JSON.stringify(chunk.metadata)}
              </div>
            )}

            <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '0.5rem' }}>
              Created: {new Date(chunk.createdAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
