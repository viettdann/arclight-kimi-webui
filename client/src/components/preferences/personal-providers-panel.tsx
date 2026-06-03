import { KeyRound, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProviderDTO, ProviderType } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { SecHead } from '@/components/ui/sec-head';
import {
  createMyProvider,
  deleteMyProvider,
  fetchMyProviderModels,
  listMyProviders,
  testMyProvider,
  updateMyProvider,
} from '../../api/providers';
import { ProviderForm } from '../../components/settings/provider-form';
import {
  emptyForm,
  formFromProvider,
  useProviderForm,
} from '../../components/settings/use-provider-form';
import { showToast } from '../../components/toast-provider';
import { refreshComposerCatalog } from '../../lib/providers-store';
import { useRegisterDirty } from '../settings/use-settings-dirty';

/** Which form is open: adding a provider of a given type, or editing one by id. */
type EditTarget = { kind: 'add'; type: ProviderType } | { kind: 'edit'; id: string } | null;

const SECTIONS: {
  type: ProviderType;
  label: string;
  description: string;
  icon: typeof KeyRound;
}[] = [
  {
    type: 'oauth',
    label: 'OAuth',
    description: 'Sign in with an OAuth token; models are fixed by the provider.',
    icon: KeyRound,
  },
  {
    type: 'api',
    label: 'API key',
    description: 'Bring your own API key and base URL, then pick the models to expose.',
    icon: Server,
  },
];

export function PersonalProvidersPanel() {
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<EditTarget>(null);
  useRegisterDirty('personal-provider-form', editing !== null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    testProvider: testMyProvider,
    fetchModels: fetchMyProviderModels,
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const { providers: list } = await listMyProviders();
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

  function startAdd(type: ProviderType) {
    setEditing({ kind: 'add', type });
    setForm(emptyForm(type));
    setSaveError(null);
    setManualModelId('');
  }

  function startEdit(p: ProviderDTO) {
    setEditing({ kind: 'edit', id: p.id });
    setForm(formFromProvider(p));
    setSaveError(null);
    setManualModelId('');
  }

  function cancelEdit() {
    setEditing(null);
    setSaveError(null);
  }

  const editingProvider =
    editing?.kind === 'edit' ? providers.find((p) => p.id === editing.id) : undefined;

  function onTest() {
    void handleTest(editingProvider?.id ?? null);
  }

  function onFetchModels() {
    void handleFetchModels(editingProvider?.id ?? null);
  }

  async function handleSave() {
    if (!editing) return;
    const namespace = form.namespace.trim();
    if (!namespace) {
      setSaveError('Namespace is required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (editing.kind === 'add') {
        const type = editing.type;
        const token = form.token ?? '';
        if (!token) {
          setSaveError('Token is required for a new provider.');
          setSaving(false);
          return;
        }
        if (type === 'api' && !form.baseUrl.trim()) {
          setSaveError('Base URL is required for API providers.');
          setSaving(false);
          return;
        }
        await createMyProvider({
          type,
          namespace,
          baseUrl: type === 'api' ? form.baseUrl.trim() || null : undefined,
          token,
          models: type === 'api' ? form.models : undefined,
        });
      } else {
        const isApi = form.type === 'api';
        await updateMyProvider(editing.id, {
          namespace,
          baseUrl: isApi ? form.baseUrl.trim() || null : undefined,
          token: form.token, // null = keep existing
          models: isApi ? form.models : undefined,
        });
      }
      setEditing(null);
      await load();
      refreshComposerCatalog();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: ProviderDTO) {
    if (!window.confirm(`Remove provider "${p.namespace}"? This cannot be undone.`)) return;
    setDeletingId(p.id);
    try {
      await deleteMyProvider(p.id);
      setProviders((prev) => prev.filter((x) => x.id !== p.id));
      if (editing?.kind === 'edit' && editing.id === p.id) setEditing(null);
      showToast({ message: 'Provider removed', type: 'info' });
      refreshComposerCatalog();
    } catch (e) {
      showToast({
        message: e instanceof Error ? e.message : 'Failed to remove provider',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  }

  function renderForm(isEdit: boolean, provider?: ProviderDTO) {
    return (
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
        isEdit={isEdit}
        existingProvider={provider}
        showVisibility={false}
      />
    );
  }

  if (loading) return <PanelSkeleton />;

  return (
    <div className="space-y-6">
      <SecHead
        title="Personal providers"
        description="Your own model providers, visible only to you. Connect with an OAuth token or your own API key."
      />

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {SECTIONS.map((section) => {
        const sectionProviders = providers.filter((p) => p.type === section.type);
        const addingHere = editing?.kind === 'add' && editing.type === section.type;
        const Icon = section.icon;
        return (
          <section key={section.type} className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">{section.label}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {sectionProviders.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
              </div>
              {!addingHere && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startAdd(section.type)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add {section.label}
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {sectionProviders.length === 0 && !addingHere && (
                <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm italic text-muted-foreground">
                  No {section.label} providers yet.
                </p>
              )}

              {sectionProviders.map((p) =>
                editing?.kind === 'edit' && editing.id === p.id ? (
                  <div key={p.id}>{renderForm(true, p)}</div>
                ) : (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    deleting={deletingId === p.id}
                    onEdit={() => startEdit(p)}
                    onRemove={() => void handleDelete(p)}
                  />
                ),
              )}

              {addingHere && renderForm(false)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface ProviderRowProps {
  provider: ProviderDTO;
  deleting: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

function ProviderRow({ provider, deleting, onEdit, onRemove }: ProviderRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate font-mono text-sm font-semibold text-foreground">
          {provider.namespace}
        </span>
        {provider.type === 'api' && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {provider.models.length} model{provider.models.length !== 1 ? 's' : ''}
          </span>
        )}
        <span className="truncate font-mono text-xs text-muted-foreground">
          {provider.tokenMasked}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} title="Edit provider">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          onClick={onRemove}
          disabled={deleting}
          title="Remove provider"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
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
