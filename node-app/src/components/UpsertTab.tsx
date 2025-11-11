// ABOUTME: Form component for upserting single chunks into the database.
// ABOUTME: Supports all three embedding providers with auto-generation based on selection.
import { useState, useEffect, FormEvent } from 'react';
import { upsertChunk, type EmbeddingProvider, type UpsertChunkResponse } from '../api';
import { initClientEmbeddings, generateClientEmbedding, onModelLoadProgress, type ModelLoadProgress } from '../embeddings/client-embeddings';

interface UpsertTabProps {
  defaultUserId?: number;
}

export default function UpsertTab({ defaultUserId = 1 }: UpsertTabProps) {
  const [id, setId] = useState<string>('');
  const [content, setContent] = useState('');
  const [channelId, setChannelId] = useState<string>('');
  const [userId] = useState<number>(defaultUserId);
  const [writerChannelId, setWriterChannelId] = useState<string>('');
  const [provider, setProvider] = useState<EmbeddingProvider>('openai');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<UpsertChunkResponse | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelLoadProgress>({
    status: 'loading',
    progress: 0,
    message: 'Not loaded'
  });

  useEffect(() => {
    if (provider === 'local' || provider === 'both') {
      const unsubscribe = onModelLoadProgress((progress) => {
        setModelStatus(progress);
      });

      initClientEmbeddings().catch((err) => {
        console.error('Failed to load local model:', err);
      });

      return unsubscribe;
    }
  }, [provider]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    if (!channelId || isNaN(Number(channelId))) {
      setError('Valid Channel ID is required');
      return;
    }

    if ((provider === 'local' || provider === 'both') && modelStatus.status !== 'ready') {
      setError('Local model is still loading. Please wait...');
      return;
    }

    setIsLoading(true);

    try {
      let embeddingLocal: number[] | undefined;

      if (provider === 'local' || provider === 'both') {
        embeddingLocal = await generateClientEmbedding(content);
      }

      const result = await upsertChunk({
        id: id ? Number(id) : undefined,
        text: content,
        channelId: Number(channelId),
        userId,
        writerChannelId: writerChannelId ? Number(writerChannelId) : null,
        provider,
        embeddingLocal,
      });

      setSuccess(result);

      // If it was a create, clear form but keep provider settings
      if (result.action === 'created') {
        setId('');
        setContent('');
        setChannelId('');
        setWriterChannelId('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upsert chunk';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2>Upsert Chunk</h2>
      <form onSubmit={handleSubmit}>
        {/* Embedding Provider Selection */}
        <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f8f9fa', borderRadius: '4px' }}>
          <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 'bold' }}>
            Embedding Provider:
          </label>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
                  1536-dim, server-side
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
                <strong>Local</strong>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  384-dim, browser-based
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="radio"
                value="both"
                checked={provider === 'both'}
                onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
                disabled={isLoading}
                style={{ marginRight: '0.5rem' }}
              />
              <div>
                <strong>Both</strong>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>
                  Generate both embeddings
                </div>
              </div>
            </label>
          </div>

          {/* Model Loading Status */}
          {(provider === 'local' || provider === 'both') && (
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
                    {modelStatus.progress}%
                  </div>
                </div>
              )}
              {modelStatus.status === 'ready' && (
                <div style={{ color: '#28a745', fontSize: '0.9rem' }}>
                  ✓ Local model ready
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

        {/* ID Field (Optional) */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="id-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            ID (optional - leave empty to create new):
          </label>
          <input
            id="id-input"
            type="number"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="Leave empty for insert"
            style={{
              width: '100%',
              fontSize: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
            }}
          />
        </div>

        {/* Content Field */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="content-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Content *:
          </label>
          <textarea
            id="content-input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter chunk content..."
            rows={5}
            style={{
              width: '100%',
              fontSize: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Channel ID Field */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="channelId-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Channel ID *:
          </label>
          <input
            id="channelId-input"
            type="number"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="e.g., 1"
            style={{
              width: '100%',
              fontSize: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
            }}
          />
        </div>

        {/* User ID Field (Prefilled, Read-only) */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="userId-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            User ID (prefilled):
          </label>
          <input
            id="userId-input"
            type="number"
            value={userId}
            disabled
            style={{
              width: '100%',
              fontSize: '1rem',
              padding: '0.75rem',
              borderRadius: '4px',
              border: '1px solid #ddd',
              background: '#f5f5f5',
              color: '#666',
            }}
          />
        </div>

        {/* Writer Channel ID Field */}
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="writerChannelId-input" style={{ display: 'block', marginBottom: '0.5rem' }}>
            Writer Channel ID (optional):
          </label>
          <input
            id="writerChannelId-input"
            type="number"
            value={writerChannelId}
            onChange={(e) => setWriterChannelId(e.target.value)}
            placeholder="Leave empty if not applicable"
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
          <div style={{ color: 'red', marginBottom: '1rem', padding: '0.75rem', background: '#fee', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ color: '#28a745', marginBottom: '1rem', padding: '0.75rem', background: '#d4edda', borderRadius: '4px' }}>
            <strong>Success!</strong> Chunk was {success.action} (ID: {success.chunk.id})
          </div>
        )}

        {/* Submit Button */}
        <div style={{ marginBottom: '1rem' }}>
          <button
            type="submit"
            disabled={isLoading || ((provider === 'local' || provider === 'both') && modelStatus.status !== 'ready')}
            style={{
              padding: '0.75rem 1.5rem',
              background: isLoading || ((provider === 'local' || provider === 'both') && modelStatus.status !== 'ready') ? '#ccc' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading || ((provider === 'local' || provider === 'both') && modelStatus.status !== 'ready') ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: '500',
            }}
          >
            {isLoading ? 'Upserting...' : 'Upsert Chunk'}
          </button>
        </div>
      </form>
    </div>
  );
}
