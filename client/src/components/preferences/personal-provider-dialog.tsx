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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createMyProvider, testMyProvider, updateMyProvider } from '../../api/providers';
import { SecretField } from '../settings/secret-field';
import { isCredentialDirty } from '../settings/use-provider-form';

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
    } else {
      setType('oauth');
      setNamespace('');
      setBaseUrl('');
      setToken(null);
    }
    setTestResult(null);
    setTestError(null);
    setTestedOk(false);
    setModelEntries([]);
    setManualModelId('');
    setFormError(null);
    setSubmitting(false);
  }, [open, provider]);

  // When test result returns availableModels, seed model entries
  // biome-ignore lint/correctness/useExhaustiveDependencies: testResult is the trigger
  useEffect(() => {
    if (!testResult?.ok || type !== 'api') return;
    const available = testResult.availableModels ?? [];
    if (available.length === 0) return;

    // On edit, pre-select models already saved to the provider
    const savedIds = new Set(provider?.models.map((m) => m.modelId) ?? []);
    const defaultId = provider?.models.find((m) => m.isDefault)?.modelId ?? available[0]?.id;

    setModelEntries(
      available.map((m) => ({
        modelId: m.id,
        displayName: m.displayName ?? m.id,
        contextWindow: m.contextWindow,
        selected: savedIds.size > 0 ? savedIds.has(m.id) : true,
        isDefault: m.id === defaultId,
      })),
    );
  }, [testResult]);

  async function handleTest() {
    setTestError(null);
    setTestResult(null);
    setTestedOk(false);

    setTesting(true);
    try {
      const result = await testMyProvider({
        type,
        baseUrl: type === 'api' ? baseUrl.trim() || null : null,
        token: token ?? null,
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

  const showModelSection = type === 'api' && testResult?.ok;
  const hasModels = modelEntries.length > 0;

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit provider' : 'Add provider'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Type selector — disabled when editing */}
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(['oauth', 'api'] as ProviderType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={isEdit}
                  onClick={() => !isEdit && setType(t)}
                  className={
                    type === t
                      ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors disabled:opacity-50'
                      : 'rounded-md border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'
                  }
                >
                  {t === 'oauth' ? 'OAuth' : 'API Key'}
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pp-namespace">Namespace</Label>
            <Input
              id="pp-namespace"
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="my-provider"
              autoFocus
            />
          </div>

          {/* Base URL (API only) */}
          {type === 'api' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pp-base-url">Base URL</Label>
              <Input
                id="pp-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </div>
          )}

          {/* Token */}
          <SecretField
            id="pp-token"
            label="Token"
            masked={provider?.tokenMasked ?? ''}
            isSet={isEdit}
            value={token}
            onChange={setToken}
            placeholder={isEdit ? 'Leave blank to keep current' : 'API token'}
          />

          {/* Test button + result */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testResult?.ok && (
              <span className="text-xs text-green-600 dark:text-green-400">Connection OK</span>
            )}
          </div>
          {testError && <p className="text-sm text-destructive">{testError}</p>}

          {/* Model selection for API type after successful test */}
          {showModelSection && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Models
              </p>
              {hasModels ? (
                <ul className="space-y-1.5">
                  {modelEntries.map((m, idx) => (
                    <li key={m.modelId} className="flex items-center gap-3">
                      <Checkbox
                        id={`pp-model-${idx}`}
                        checked={m.selected}
                        onChange={() => toggleModelSelected(idx)}
                      />
                      <label htmlFor={`pp-model-${idx}`} className="flex-1 cursor-pointer text-sm">
                        <span className="font-medium">{m.displayName}</span>
                        {m.displayName !== m.modelId && (
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                            {m.modelId}
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        disabled={!m.selected}
                        onClick={() => setDefaultModel(idx)}
                        className={
                          m.isDefault
                            ? 'text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 border border-primary bg-primary text-primary-foreground'
                            : 'text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 border border-border text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40'
                        }
                      >
                        {m.isDefault ? 'Default' : 'Set default'}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  No models returned. Add one manually below.
                </p>
              )}

              {/* Manual add row */}
              <div className="flex gap-2 pt-1">
                <Input
                  type="text"
                  value={manualModelId}
                  onChange={(e) => setManualModelId(e.target.value)}
                  placeholder="model-id (e.g. gpt-4o)"
                  className="h-7 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addManualModel();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={addManualModel}>
                  Add
                </Button>
              </div>
            </div>
          )}

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || (credentialDirty && !testedOk)}>
              {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
