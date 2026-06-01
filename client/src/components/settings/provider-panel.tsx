import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProviderDTO, Visibility } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { SecHead } from '@/components/ui/sec-head';
import {
  createBuiltinProvider,
  deleteBuiltinProvider,
  fetchBuiltinProviderModels,
  listBuiltinProviders,
  testBuiltinProvider,
  updateBuiltinProvider,
} from '../../api/providers';
import { showToast } from '../../components/toast-provider';
import { refreshComposerCatalog } from '../../lib/providers-store';
import { cn } from '../../lib/utils';
import { ProviderForm } from './provider-form';
import { emptyForm, formFromProvider, useProviderForm } from './use-provider-form';

// ── Main component ────────────────────────────────────────────────────────────

export function ProviderPanel() {
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Which provider is being edited (by id), or 'new' for the add form, or null. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Which provider id has a delete request in flight, or null. */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const {
    form,
    setForm,
    patchForm,
    manualModelId,
    setManualModelId,
    handleTest,
    handleFetchModels,
    toggleModelDefault,
    toggleModelSelected,
    addManualModel,
  } = useProviderForm({
    testProvider: testBuiltinProvider,
    fetchModels: fetchBuiltinProviderModels,
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const { providers: list } = await listBuiltinProviders();
      setProviders(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    void load();
  }, []);

  function startAdd() {
    setEditing('new');
    setForm(emptyForm());
    setSaveError(null);
    setManualModelId('');
  }

  function startEdit(p: ProviderDTO) {
    setEditing(p.id);
    setForm(formFromProvider(p));
    setSaveError(null);
    setManualModelId('');
  }

  function cancelEdit() {
    setEditing(null);
    setSaveError(null);
  }

  function onTest() {
    const editingProvider = editing !== 'new' ? providers.find((p) => p.id === editing) : undefined;
    void handleTest(editingProvider?.id ?? null);
  }

  function onFetchModels() {
    const editingProvider = editing !== 'new' ? providers.find((p) => p.id === editing) : undefined;
    void handleFetchModels(editingProvider?.id ?? null);
  }

  async function handleSave() {
    if (editing === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing === 'new') {
        const token = form.token ?? '';
        if (!token) {
          setSaveError('Token is required for a new provider.');
          setSaving(false);
          return;
        }
        const created = await createBuiltinProvider({
          type: 'api',
          namespace: form.namespace,
          baseUrl: form.baseUrl || null,
          token,
          visibility: form.visibility,
          models: form.models,
        });
        setProviders((prev) => [...prev, created]);
      } else {
        const updated = await updateBuiltinProvider(editing, {
          namespace: form.namespace,
          baseUrl: form.baseUrl || null,
          token: form.token, // null = keep existing
          visibility: form.visibility,
          models: form.models,
        });
        setProviders((prev) => prev.map((p) => (p.id === editing ? updated : p)));
      }
      setEditing(null);
      refreshComposerCatalog();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this provider? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deleteBuiltinProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
      if (editing === id) setEditing(null);
      refreshComposerCatalog();
    } catch (e) {
      // Surface as inline error rather than crashing.
      setLoadError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleVisibilityToggle(p: ProviderDTO) {
    const prevVisibility = p.visibility;
    const next: Visibility = prevVisibility === 'public' ? 'private' : 'public';
    // Optimistically reflect the new visibility in local state.
    setProviders((prev) => prev.map((x) => (x.id === p.id ? { ...x, visibility: next } : x)));
    try {
      const updated = await updateBuiltinProvider(p.id, { visibility: next });
      setProviders((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      refreshComposerCatalog();
    } catch (e) {
      // Roll back the optimistic change and surface the error.
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, visibility: prevVisibility } : x)),
      );
      showToast({
        message: e instanceof Error ? e.message : 'Failed to update visibility',
        type: 'error',
      });
    }
  }

  if (loading) return <PanelSkeleton />;

  return (
    <div className="space-y-6">
      <SecHead
        title="Built-in providers"
        description="API providers shared across all users. Credentials are stored server-side and never exposed to clients."
        actions={
          editing !== 'new' && (
            <Button type="button" variant="outline" size="sm" onClick={startAdd}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add provider
            </Button>
          )
        }
      />

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <div className="space-y-3">
        {providers.length === 0 && editing !== 'new' && (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm italic text-muted-foreground">
            No built-in providers configured.
          </p>
        )}

        {providers.map((p) =>
          editing === p.id ? (
            <ProviderForm
              key={p.id}
              form={form}
              patchForm={patchForm}
              onTest={onTest}
              onSave={handleSave}
              onCancel={cancelEdit}
              onFetchModels={onFetchModels}
              onToggleModelDefault={toggleModelDefault}
              onToggleModelSelected={toggleModelSelected}
              manualModelId={manualModelId}
              onManualModelIdChange={setManualModelId}
              onAddManualModel={addManualModel}
              saving={saving}
              saveError={saveError}
              isEdit
              existingProvider={p}
            />
          ) : (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="font-mono text-sm font-semibold text-foreground">
                  {p.namespace}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {p.models.length} model{p.models.length !== 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void handleVisibilityToggle(p)}
                  title="Toggle visibility"
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                    p.visibility === 'public'
                      ? 'bg-primary-wash text-primary-hover hover:bg-primary-wash/70'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70',
                  )}
                >
                  {p.visibility === 'public' ? 'Public' : 'Private'}
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => startEdit(p)}
                  title="Edit provider"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleDelete(p.id)}
                  disabled={deletingId === p.id}
                  title="Remove provider"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ),
        )}

        {editing === 'new' && (
          <ProviderForm
            form={form}
            patchForm={patchForm}
            onTest={onTest}
            onSave={handleSave}
            onCancel={cancelEdit}
            onFetchModels={onFetchModels}
            onToggleModelDefault={toggleModelDefault}
            onToggleModelSelected={toggleModelSelected}
            manualModelId={manualModelId}
            onManualModelIdChange={setManualModelId}
            onAddManualModel={addManualModel}
            saving={saving}
            saveError={saveError}
            isEdit={false}
          />
        )}
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
