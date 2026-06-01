import { Check, KeyRound, Plus } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type {
  ProviderDTO,
  ProviderModelInput,
  ProviderTestResponse,
  ProviderType,
} from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '../../lib/utils';
import {
  createMyProvider,
  fetchMyProviderModels,
  testMyProvider,
  updateMyProvider,
} from '../../api/providers';
import { SecretField } from '../settings/secret-field';
import { isCredentialDirty, probeReadiness } from '../settings/use-provider-form';

export interface PersonalProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: ProviderDTO | null;
  onSaved?: () => void;
}

interface ModelEntry {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  selected: boolean;
  isDefault: boolean;
}

export function PersonalProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved,
}: PersonalProviderDialogProps) {
  const isEdit = provider != null;

  // Form fields
  const [type, setType] = useState<ProviderType>('oauth');
  const [namespace, setNamespace] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  // token: null = keep saved secret; string = new value being entered
  const [token, setToken] = useState<string | null>(null);

  // Test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Model selection (api type only)
  const [modelEntries, setModelEntries] = useState<ModelEntry[]>([]);
  const [manualModelId, setManualModelId] = useState('');

  // Fetch-models probe state (api type only)
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

  // Save state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // A successful test in the current form session enables Save
  const [testedOk, setTestedOk] = useState(false);

  // Reset form when dialog opens or target provider changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: open/provider are the triggers
  useEffect(() => {
    if (provider) {
      setType(provider.type);
      setNamespace(provider.namespace);
      setBaseUrl(provider.baseUrl ?? '');
      setToken(null);
      // Seed the saved models so an api provider shows its selection immediately,
      // before any fetch.
      setModelEntries(
        provider.type === 'api'
          ? provider.models.map((m) => ({
              modelId: m.modelId,
              displayName: m.displayName ?? m.modelId,
              contextWindow: m.contextWindow,
              selected: true,
              isDefault: m.isDefault,
            }))
          : [],
      );
    } else {
      setType('oauth');
      setNamespace('');
      setBaseUrl('');
      setToken(null);
      setModelEntries([]);
    }
    setTestResult(null);
    setTestError(null);
    setTestedOk(false);
    setManualModelId('');
    setFormError(null);
    setSubmitting(false);
    setFetchingModels(false);
    setFetchModelsError(null);
  }, [open, provider]);

  async function handleTest() {
    setTestError(null);
    setTestResult(null);
    setTestedOk(false);

    // Ping with the chosen default (else first selected) model so a
    // manually-entered model validates even without a listable /models endpoint.
    const model =
      modelEntries.find((m) => m.selected && m.isDefault)?.modelId ??
      modelEntries.find((m) => m.selected)?.modelId ??
      modelEntries[0]?.modelId ??
      null;

    setTesting(true);
    try {
      const result = await testMyProvider({
        type,
        baseUrl: type === 'api' ? baseUrl.trim() || null : null,
        token: token ?? null,
        model: type === 'api' ? model : null,
        providerId: isEdit ? provider?.id : undefined,
      });
      setTestResult(result);
      if (result.ok) {
        setTestedOk(true);
      } else {
        setTestError(result.error ?? 'Test failed');
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleFetchModels() {
    setFetchModelsError(null);
    setFetchingModels(true);
    try {
      const { models } = await fetchMyProviderModels({
        type,
        baseUrl: type === 'api' ? baseUrl.trim() || null : null,
        token: token ?? null,
        providerId: isEdit ? provider?.id : undefined,
      });
      if (models.length === 0) {
        setFetchModelsError('No models returned — add one manually below.');
        return;
      }
      setModelEntries((prev) => {
        const prevById = new Map(prev.map((m) => [m.modelId, m]));
        // Fetched models become the option list, preserving prior selection;
        // entries added manually that the endpoint omits are kept.
        const merged: ModelEntry[] = models.map((m) => {
          const existing = prevById.get(m.id);
          return {
            modelId: m.id,
            displayName: m.displayName ?? m.id,
            contextWindow: m.contextWindow,
            selected: existing?.selected ?? !isEdit,
            isDefault: existing?.isDefault ?? false,
          };
        });
        for (const m of prev) {
          if (!models.some((x) => x.id === m.modelId)) merged.push(m);
        }
        // Guarantee one default among the selected entries.
        if (merged.some((m) => m.selected) && !merged.some((m) => m.selected && m.isDefault)) {
          const firstSel = merged.find((m) => m.selected);
          if (firstSel) firstSel.isDefault = true;
        }
        return merged;
      });
    } catch (err) {
      setFetchModelsError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setFetchingModels(false);
    }
  }

  function toggleModelSelected(idx: number) {
    setModelEntries((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, selected: !m.selected } : m)),
    );
  }

  function setDefaultModel(idx: number) {
    setModelEntries((prev) => prev.map((m, i) => ({ ...m, isDefault: i === idx })));
  }

  function addManualModel() {
    const id = manualModelId.trim();
    if (!id) return;
    if (modelEntries.some((m) => m.modelId === id)) {
      setManualModelId('');
      return;
    }
    setModelEntries((prev) => [
      ...prev,
      {
        modelId: id,
        displayName: id,
        contextWindow: null,
        selected: true,
        isDefault: prev.length === 0,
      },
    ]);
    setManualModelId('');
  }

  function buildModels(): ProviderModelInput[] {
    return modelEntries
      .filter((m) => m.selected)
      .map((m) => ({
        modelId: m.modelId,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        isDefault: m.isDefault,
      }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedNamespace = namespace.trim();
    if (!trimmedNamespace) {
      setFormError('Namespace is required');
      return;
    }
    if (type === 'api' && !baseUrl.trim()) {
      setFormError('Base URL is required for API providers');
      return;
    }
    if (!isEdit && token === null) {
      setFormError('Token is required');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (isEdit && provider) {
        await updateMyProvider(provider.id, {
          namespace: trimmedNamespace,
          baseUrl: type === 'api' ? baseUrl.trim() || null : undefined,
          token: token !== null ? token : undefined,
          models: type === 'api' ? buildModels() : undefined,
        });
      } else {
        await createMyProvider({
          type,
          namespace: trimmedNamespace,
          baseUrl: type === 'api' ? baseUrl.trim() || null : undefined,
          token: token ?? '',
          models: type === 'api' ? buildModels() : undefined,
        });
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save provider');
      setSubmitting(false);
    }
  }

  const hasModels = modelEntries.length > 0;
  const { canProbe, fetchReady } = probeReadiness(token, baseUrl, isEdit);
  const selectedModelCount = modelEntries.filter((m) => m.selected).length;
  // Fetch (api) needs base URL + key. Test additionally needs a selected model;
  // oauth has neither base URL nor a model list, so the key alone enables it.
  const testReady = type === 'api' ? fetchReady && selectedModelCount > 0 : canProbe;

  // Credentials are "dirty" when the token or base URL differs from the saved value.
  // OAuth providers have no base URL, so only the API path compares base URLs;
  // passing the same value as `savedBaseUrl` neutralizes that term for OAuth.
  const savedBaseUrl = provider?.baseUrl ?? '';
  const credentialDirty = isCredentialDirty({
    token,
    baseUrl: type === 'api' ? baseUrl.trim() : savedBaseUrl,
    savedBaseUrl,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[600px]">
        <form onSubmit={handleSubmit} className="flex max-h-[calc(100dvh-6rem)] flex-col">
          {/* Header */}
          <div className="shrink-0 border-b border-border px-7 pt-7 pb-5">
            <DialogTitle className="text-xl font-medium tracking-tight">
              {isEdit ? 'Edit provider' : 'Add provider'}
            </DialogTitle>
            <DialogDescription className="mt-1.5">
              Configure a personal model provider. Only you can see it.
            </DialogDescription>
          </div>

          {/* Body — scrollable */}
          <div className="flex flex-col gap-7 overflow-y-auto px-7 py-7">
            {/* Type selector — segmented, disabled when editing */}
            <div className="flex flex-col gap-2">
              <Label>Type</Label>
              <div className="inline-flex w-fit rounded-md border border-border bg-muted p-0.5">
                {(['oauth', 'api'] as ProviderType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={isEdit}
                    onClick={() => !isEdit && setType(t)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-[5px] px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
                      type === t
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground disabled:opacity-50',
                    )}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {t === 'oauth' ? 'OAuth' : 'API key'}
                  </button>
                ))}
              </div>
              {isEdit && (
                <p className="text-xs text-muted-foreground">
                  Type cannot be changed after creation.
                </p>
              )}
            </div>

            {/* Namespace */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="pp-namespace">Namespace</Label>
              <Input
                id="pp-namespace"
                type="text"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="my-openai"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Used to prefix model IDs, e.g.{' '}
                <span className="font-mono">{namespace.trim() || 'my-openai'}/gpt-4o</span>.
              </p>
            </div>

            {/* Base URL (API only) */}
            {type === 'api' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pp-base-url">Base URL</Label>
                <Input
                  id="pp-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
            )}

            {/* Credentials. For API providers, Models sits beside the token. */}
            {type === 'api' ? (
              <div className="grid grid-cols-1 gap-x-7 gap-y-7 sm:grid-cols-2 sm:items-start">
                <SecretField
                  id="pp-token"
                  label="Token"
                  masked={provider?.tokenMasked ?? ''}
                  isSet={isEdit}
                  value={token}
                  onChange={setToken}
                  placeholder={isEdit ? 'Leave blank to keep current' : 'API key'}
                />
                <div className="flex flex-col gap-2">
                  <Label>Models</Label>
                  <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
                    {fetchModelsError && (
                      <p className="px-1 text-xs italic text-muted-foreground">
                        {fetchModelsError}
                      </p>
                    )}
                    {hasModels ? (
                      <ul className="max-h-52 space-y-0.5 overflow-y-auto">
                        {modelEntries.map((m, idx) => (
                          <li
                            key={m.modelId}
                            className="flex items-center gap-2.5 rounded-[5px] px-1.5 py-1.5 hover:bg-card"
                          >
                            <Checkbox
                              id={`pp-model-${idx}`}
                              checked={m.selected}
                              onChange={() => toggleModelSelected(idx)}
                            />
                            <label
                              htmlFor={`pp-model-${idx}`}
                              className="min-w-0 flex-1 cursor-pointer truncate font-mono text-[13px]"
                            >
                              {m.displayName}
                            </label>
                            {m.selected && (
                              <button
                                type="button"
                                onClick={() => setDefaultModel(idx)}
                                className={cn(
                                  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
                                  m.isDefault
                                    ? 'bg-primary-wash text-primary-hover'
                                    : 'border border-border-strong text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {m.isDefault ? 'Default' : 'Set default'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-1 py-2 text-xs italic text-muted-foreground">
                        No models yet — fetch them or add one manually below.
                      </p>
                    )}

                    {/* Manual add row */}
                    <div className="flex gap-2 pt-2">
                      <Input
                        type="text"
                        value={manualModelId}
                        onChange={(e) => setManualModelId(e.target.value)}
                        placeholder="model-id (e.g. gpt-4o)"
                        className="text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addManualModel();
                          }
                        }}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={addManualModel}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <SecretField
                id="pp-token"
                label="Token"
                masked={provider?.tokenMasked ?? ''}
                isSet={isEdit}
                value={token}
                onChange={setToken}
                placeholder={isEdit ? 'Leave blank to keep current' : 'OAuth token'}
              />
            )}

            {/* Connection — test + fetch-models actions */}
            <div className="flex flex-col gap-2">
              <Label>Connection</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={testing || !testReady}
                  title={
                    testReady
                      ? undefined
                      : type === 'api'
                        ? 'Fill base URL, API key, and select a model first'
                        : 'Enter a token first'
                  }
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </Button>
                {type === 'api' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !fetchReady}
                    title={
                      fetchReady ? 'Probe the /models endpoint' : 'Fill base URL and API key first'
                    }
                  >
                    {fetchingModels ? 'Fetching…' : 'Fetch models'}
                  </Button>
                )}
                {testResult?.ok && (
                  <span className="inline-flex items-center gap-1 text-sm text-success">
                    <Check className="h-3.5 w-3.5" />
                    Connection OK
                  </span>
                )}
              </div>
              {testError && <p className="text-sm text-destructive">{testError}</p>}
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          {/* Footer — pinned action bar */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card-2 px-7 py-5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || (credentialDirty && !testedOk)}>
              <Check className="mr-1 h-3.5 w-3.5" />
              {submitting ? 'Saving…' : isEdit ? 'Save provider' : 'Save provider'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
