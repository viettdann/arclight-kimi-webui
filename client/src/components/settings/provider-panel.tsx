import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProviderDTO, Visibility } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import {
  createBuiltinProvider,
  deleteBuiltinProvider,
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
    toggleModelDefault,
    toggleModelSelected,
    addManualModel,
  } = useProviderForm({ testProvider: testBuiltinProvider });

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
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <Section
        title="Built-in Providers"
        description="API providers available to all users. Type is always API."
        actions={
          editing !== 'new' && (
            <Button type="button" variant="outline" size="sm" onClick={startAdd}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add provider
            </Button>
          )
        }
      >
        {providers.length === 0 && editing !== 'new' && (
          <p className="text-sm text-muted-foreground">No built-in providers configured.</p>
        )}

        {providers.length > 0 && (
          <ul className="space-y-2">
            {providers.map((p) => (
              <li
                key={p.id}
                className={cn(
                  'rounded-md border border-border bg-muted/30 px-3 py-2',
                  editing === p.id && 'border-primary bg-primary/5',
                )}
              >
                {editing === p.id ? (
                  <ProviderForm
                    form={form}
                    patchForm={patchForm}
                    onTest={onTest}
                    onSave={handleSave}
                    onCancel={cancelEdit}
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium font-mono">{p.namespace}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {p.models.length} model{p.models.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleVisibilityToggle(p)}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium border transition-colors cursor-pointer',
                          p.visibility === 'public'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
                        )}
                        title="Toggle visibility"
                      >
                        {p.visibility === 'public' ? 'Public' : 'Private'}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startEdit(p)}
                        title="Edit provider"
                      >
                        <Pencil className="h-3.5 w-3.5" />
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
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {editing === 'new' && (
          <div className="rounded-md border border-primary bg-primary/5 px-3 py-3 mt-2">
            <p className="text-xs font-semibold text-foreground mb-3">New provider</p>
            <ProviderForm
              form={form}
              patchForm={patchForm}
              onTest={onTest}
              onSave={handleSave}
              onCancel={cancelEdit}
              onToggleModelDefault={toggleModelDefault}
              onToggleModelSelected={toggleModelSelected}
              manualModelId={manualModelId}
              onManualModelIdChange={setManualModelId}
              onAddManualModel={addManualModel}
              saving={saving}
              saveError={saveError}
              isEdit={false}
            />
          </div>
        )}
      </Section>
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
