import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  ProviderDTO,
  ProviderModelInput,
  ProviderTestResponse,
  Visibility,
} from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import {
  createBuiltinProvider,
  deleteBuiltinProvider,
  listBuiltinProviders,
  testBuiltinProvider,
  updateBuiltinProvider,
} from '../../api/providers';
import { cn } from '../../lib/utils';
import { SecretField } from './secret-field';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProviderFormState {
  namespace: string;
  baseUrl: string;
  /** Plaintext token draft, or null when editing and the user hasn't replaced it yet. */
  token: string | null;
  visibility: Visibility;
  /** Models selected for this provider. */
  models: ProviderModelInput[];
  /** Whether the current form session has a successful test result. */
  tested: boolean;
  testResult: ProviderTestResponse | null;
  testing: boolean;
}

function emptyForm(): ProviderFormState {
  return {
    namespace: '',
    baseUrl: '',
    token: null,
    visibility: 'private',
    models: [],
    tested: false,
    testResult: null,
    testing: false,
  };
}

function formFromProvider(p: ProviderDTO): ProviderFormState {
  return {
    namespace: p.namespace,
    baseUrl: p.baseUrl ?? '',
    token: null, // null = keep existing secret
    visibility: p.visibility ?? 'private',
    models: p.models.map((m) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      isDefault: m.isDefault,
    })),
    tested: false,
    testResult: null,
    testing: false,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProviderPanel() {
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Which provider is being edited (by id), or 'new' for the add form, or null. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<ProviderFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Manual model id input for when test returns no models. */
  const [manualModelId, setManualModelId] = useState('');

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

  function patchForm(patch: Partial<ProviderFormState>) {
    // Changing any credential field invalidates a previous test result.
    const credentialChanged = 'baseUrl' in patch || 'token' in patch;
    setForm((prev) => ({
      ...prev,
      ...patch,
      ...(credentialChanged ? { tested: false, testResult: null } : {}),
    }));
  }

  async function handleTest() {
    patchForm({ testing: true, testResult: null });
    const editingProvider = editing !== 'new' ? providers.find((p) => p.id === editing) : undefined;
    try {
      const res = await testBuiltinProvider({
        type: 'api',
        baseUrl: form.baseUrl || null,
        token: form.token, // null = reuse saved secret
        providerId: editingProvider?.id ?? null,
      });
      setForm((prev) => ({
        ...prev,
        testing: false,
        testResult: res,
        tested: res.ok,
        // Auto-populate models from test result (replace existing draft).
        models:
          res.ok && res.availableModels && res.availableModels.length > 0
            ? res.availableModels.map((m, i) => ({
                modelId: m.id,
                displayName: m.displayName,
                contextWindow: m.contextWindow,
                isDefault: i === 0,
              }))
            : prev.models,
      }));
    } catch (e) {
      setForm((prev) => ({
        ...prev,
        testing: false,
        testResult: { ok: false, error: e instanceof Error ? e.message : 'Test failed' },
        tested: false,
      }));
    }
  }

  function toggleModelDefault(modelId: string) {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m) => ({ ...m, isDefault: m.modelId === modelId })),
    }));
  }

  function toggleModelSelected(
    modelId: string,
    displayName: string | null,
    contextWindow: number | null,
  ) {
    setForm((prev) => {
      const exists = prev.models.some((m) => m.modelId === modelId);
      if (exists) {
        const next = prev.models.filter((m) => m.modelId !== modelId);
        // Ensure at least one default.
        if (next.length > 0 && !next.some((m) => m.isDefault)) {
          const first = next[0];
          if (first) next[0] = { ...first, isDefault: true };
        }
        return { ...prev, models: next };
      }
      return {
        ...prev,
        models: [
          ...prev.models,
          { modelId, displayName, contextWindow, isDefault: prev.models.length === 0 },
        ],
      };
    });
  }

  function addManualModel() {
    const id = manualModelId.trim();
    if (!id) return;
    toggleModelSelected(id, null, null);
    setManualModelId('');
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
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBuiltinProvider(id);
      setProviders((prev) => prev.filter((p) => p.id !== id));
      if (editing === id) setEditing(null);
    } catch (e) {
      // Surface as inline error rather than crashing.
      setLoadError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function handleVisibilityToggle(p: ProviderDTO) {
    const next: Visibility = p.visibility === 'public' ? 'private' : 'public';
    try {
      const updated = await updateBuiltinProvider(p.id, { visibility: next });
      setProviders((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
    } catch {
      // swallow — no toast infra in this panel
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
                    onTest={handleTest}
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
              onTest={handleTest}
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

// ── Form sub-component ────────────────────────────────────────────────────────

interface ProviderFormProps {
  form: ProviderFormState;
  patchForm: (patch: Partial<ProviderFormState>) => void;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
  onToggleModelDefault: (modelId: string) => void;
  onToggleModelSelected: (
    modelId: string,
    displayName: string | null,
    contextWindow: number | null,
  ) => void;
  manualModelId: string;
  onManualModelIdChange: (v: string) => void;
  onAddManualModel: () => void;
  saving: boolean;
  saveError: string | null;
  isEdit: boolean;
  existingProvider?: ProviderDTO;
}

function ProviderForm({
  form,
  patchForm,
  onTest,
  onSave,
  onCancel,
  onToggleModelDefault,
  onToggleModelSelected,
  manualModelId,
  onManualModelIdChange,
  onAddManualModel,
  saving,
  saveError,
  isEdit,
  existingProvider,
}: ProviderFormProps) {
  const availableFromTest = form.testResult?.availableModels ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pf-namespace">Namespace</Label>
          <Input
            id="pf-namespace"
            value={form.namespace}
            placeholder="e.g. anthropic"
            onChange={(e) => patchForm({ namespace: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-base-url">Base URL</Label>
          <Input
            id="pf-base-url"
            value={form.baseUrl}
            placeholder="https://api.anthropic.com"
            onChange={(e) => patchForm({ baseUrl: e.target.value })}
          />
        </div>
      </div>

      <SecretField
        id="pf-token"
        label="Auth token"
        masked={existingProvider?.tokenMasked ?? ''}
        isSet={isEdit && !!existingProvider}
        value={form.token}
        onChange={(v) => patchForm({ token: v })}
        placeholder="Enter API token"
      />

      <div className="flex items-center gap-2">
        <Label className="shrink-0">Visibility</Label>
        <button
          type="button"
          onClick={() =>
            patchForm({ visibility: form.visibility === 'public' ? 'private' : 'public' })
          }
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors cursor-pointer',
            form.visibility === 'public'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
          )}
        >
          {form.visibility === 'public' ? 'Public' : 'Private'}
        </button>
      </div>

      {/* Test button */}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={form.testing} onClick={onTest}>
          {form.testing ? 'Testing…' : 'Test connection'}
        </Button>
        {form.testResult && (
          <span
            className={
              form.testResult.ok
                ? 'text-sm text-emerald-600 dark:text-emerald-400'
                : 'text-sm text-destructive'
            }
          >
            {form.testResult.ok
              ? `OK · ${availableFromTest.length > 0 ? `${availableFromTest.length} model${availableFromTest.length !== 1 ? 's' : ''} found` : 'no models returned'}`
              : (form.testResult.error ?? 'Connection failed')}
          </span>
        )}
      </div>

      {/* Model selection — shown after a successful test OR if editing with existing models */}
      {(form.tested || (isEdit && form.models.length > 0)) && (
        <ModelChecklist
          availableModels={availableFromTest}
          selectedModels={form.models}
          onToggleSelected={onToggleModelSelected}
          onToggleDefault={onToggleModelDefault}
          manualModelId={manualModelId}
          onManualModelIdChange={onManualModelIdChange}
          onAddManualModel={onAddManualModel}
        />
      )}

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={saving || !form.tested}
          onClick={onSave}
          title={!form.tested ? 'Run a successful test first' : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ── Model checklist ────────────────────────────────────────────────────────────

interface ModelChecklistProps {
  availableModels: { id: string; displayName: string | null; contextWindow: number | null }[];
  selectedModels: ProviderModelInput[];
  onToggleSelected: (
    modelId: string,
    displayName: string | null,
    contextWindow: number | null,
  ) => void;
  onToggleDefault: (modelId: string) => void;
  manualModelId: string;
  onManualModelIdChange: (v: string) => void;
  onAddManualModel: () => void;
}

function ModelChecklist({
  availableModels,
  selectedModels,
  onToggleSelected,
  onToggleDefault,
  manualModelId,
  onManualModelIdChange,
  onAddManualModel,
}: ModelChecklistProps) {
  // Union of available-from-test and already-selected.
  const displayIds = new Set([
    ...availableModels.map((m) => m.id),
    ...selectedModels.map((m) => m.modelId),
  ]);

  return (
    <div className="space-y-2">
      <Label>Models</Label>
      <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
        {[...displayIds].map((modelId) => {
          const avail = availableModels.find((m) => m.id === modelId);
          const sel = selectedModels.find((m) => m.modelId === modelId);
          const checked = !!sel;
          return (
            <label
              key={modelId}
              className="flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onToggleSelected(
                    modelId,
                    avail?.displayName ?? null,
                    avail?.contextWindow ?? null,
                  )
                }
                className="h-3.5 w-3.5"
              />
              <span className="flex-1 text-sm font-mono">{avail?.displayName ?? modelId}</span>
              {checked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onToggleDefault(modelId);
                  }}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
                    sel?.isDefault
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  title="Set as default"
                >
                  {sel?.isDefault && <Check className="h-3 w-3" />}
                  {sel?.isDefault ? 'Default' : 'Set default'}
                </button>
              )}
            </label>
          );
        })}
        {displayIds.size === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No models from test — add manually below.
          </p>
        )}
      </div>
      {/* Manual add row (always shown) */}
      <div className="flex gap-2">
        <Input
          value={manualModelId}
          onChange={(e) => onManualModelIdChange(e.target.value)}
          placeholder="Add model id manually…"
          className="text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAddManualModel();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={onAddManualModel}>
          Add
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
