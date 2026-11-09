import { useEffect, useState } from 'react';
import { defaultGeneration, resolveGeneration, type GenerationSettings, type ModelCatalog } from '../shared/models';

export function GenerationControls({ bookId, settings, disabled, active, onSave }: {
  bookId: string;
  settings: GenerationSettings;
  disabled: boolean;
  active: boolean;
  onSave: (settings: GenerationSettings) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setCatalog(undefined);
    fetch(`/api/books/${bookId}/models`, { signal: abort.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load Codex models.');
      if (!abort.signal.aborted) setCatalog(result);
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [bookId, reload]);

  const preference = settings || defaultGeneration();
  const resolved = catalog && resolveGeneration(catalog, preference);
  const model = catalog?.models.find(m => m.model === resolved?.model);
  async function save(next: GenerationSettings) {
    setSaving(true); setError('');
    try { await onSave(next); } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <div className="generation-controls">
    <div className="generation-selectors">
      <label>Model
        <select aria-label="Model" disabled={disabled || loading || saving || !catalog} value={preference.model || ''} onChange={e => void save({ model: e.target.value || null, effort: null })}>
          <option value="">{loading ? 'Loading models…' : `Codex default${catalog?.defaultModel ? ` · ${catalog.defaultModel}` : ''}`}</option>
          {preference.model && !catalog?.models.some(m => m.model === preference.model) && <option value={preference.model}>{preference.model} · unavailable</option>}
          {catalog?.models.map(m => <option key={m.model} value={m.model}>{m.displayName}</option>)}
        </select>
      </label>
      <label>Reasoning
        <select aria-label="Reasoning effort" disabled={disabled || loading || saving || !model?.supportedReasoningEfforts.length} value={preference.effort || ''} onChange={e => void save({ ...preference, effort: e.target.value || null })}>
          <option value="">Default{resolved?.effort && !preference.effort ? ` · ${resolved.effort}` : ''}</option>
          {preference.effort && !model?.supportedReasoningEfforts.some(e => e.reasoningEffort === preference.effort) && <option value={preference.effort}>{preference.effort} · unavailable</option>}
          {model?.supportedReasoningEfforts.map(e => <option key={e.reasoningEffort} value={e.reasoningEffort} title={e.description}>{e.reasoningEffort}</option>)}
        </select>
      </label>
      <span className="generation-setting-note" role="status">{saving ? 'Saving…' : active ? 'Next generation · current work keeps its settings' : 'Saved for this book · applies to new generation'}</span>
    </div>
    {error && <div className="model-error" role="alert">{error} <button type="button" onClick={() => setReload(n => n + 1)}>Reload models</button></div>}
  </div>;
}
