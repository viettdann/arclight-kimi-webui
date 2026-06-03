import { Check, KeyRound, RefreshCw, Server, Zap } from 'lucide-react';
import type { ProviderDTO } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '../../lib/utils';
import { ModelChecklist } from './model-checklist';
import { SecretField } from './secret-field';
import { isCredentialDirty, type ProviderFormState, probeReadiness } from './use-provider-form';

export interface ProviderFormProps {
  form: ProviderFormState;
  patchForm: (patch: Partial<ProviderFormState>) => void;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
  onFetchModels: () => void;
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
  /** Show the public/private toggle. Built-in providers only; Personal hides it. */
  showVisibility?: boolean;
}

export function ProviderForm({
  form,
  patchForm,
  onTest,
  onSave,
  onCancel,
  onFetchModels,
  onToggleModelDefault,
  onToggleModelSelected,
  manualModelId,
  onManualModelIdChange,
  onAddManualModel,
  saving,
  saveError,
  isEdit,
  existingProvider,
  showVisibility = true,
}: ProviderFormProps) {
  // OAuth providers carry only a token — no base URL, no user-managed models.
  const isOauth = form.type === 'oauth';

  const credentialDirty = isCredentialDirty({
    token: form.token,
    baseUrl: form.baseUrl,
    savedBaseUrl: existingProvider?.baseUrl ?? '',
  });

  // Fetch (api) needs base URL + key. Test additionally needs a model to ping.
  // OAuth has neither, so a present/saved token alone enables Test.
  const { canProbe, fetchReady } = probeReadiness(form.token, form.baseUrl, isEdit);
  const testReady = isOauth ? canProbe : fetchReady && form.models.length > 0;

  const tokenLabel = isOauth ? 'OAuth token' : 'API Key';

  return (
    <div className="overflow-hidden rounded-lg border border-primary/40 bg-card shadow-sm">
      {/* Header — clay-washed band identifying the provider being edited. */}
      <header className="flex items-center justify-between gap-3 border-b border-primary/20 bg-primary-wash px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {isOauth ? (
            <KeyRound className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Server className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="truncate font-mono text-sm font-semibold text-foreground">
            {form.namespace || (isEdit ? existingProvider?.namespace : 'New provider')}
          </span>
          <span className="text-xs font-medium text-primary">{isEdit ? 'Editing' : 'New'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isOauth && (
            <span className="rounded-full bg-card/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {form.models.length} model{form.models.length !== 1 ? 's' : ''}
            </span>
          )}
          {showVisibility && (
            <span className="rounded-full bg-card/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {form.visibility === 'public' ? 'Public' : 'Private'}
            </span>
          )}
        </div>
      </header>

      {/* Body — two columns: identity/key on the left, endpoint/models right. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 py-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pf-namespace">Namespace</Label>
          <Input
            id="pf-namespace"
            value={form.namespace}
            placeholder="e.g. anthropic"
            onChange={(e) => patchForm({ namespace: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Prefix for model ids, e.g. <span className="font-mono">anthropic/claude-…</span>
          </p>
        </div>

        {!isOauth && (
          <div className="space-y-1.5">
            <Label htmlFor="pf-base-url">Base URL</Label>
            <Input
              id="pf-base-url"
              value={form.baseUrl}
              placeholder="https://api.anthropic.com"
              onChange={(e) => patchForm({ baseUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Override for proxies or self-hosted gateways.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <SecretField
            id="pf-token"
            label={tokenLabel}
            masked={existingProvider?.tokenMasked ?? ''}
            isSet={isEdit && !!existingProvider}
            value={form.token}
            onChange={(v) => patchForm({ token: v })}
            placeholder={isOauth ? 'Enter OAuth token' : 'Enter API key'}
          />
        </div>

        {!isOauth && (
          <div className="space-y-1.5">
            <ModelChecklist
              availableModels={form.availableModels}
              selectedModels={form.models}
              onToggleSelected={onToggleModelSelected}
              onToggleDefault={onToggleModelDefault}
              manualModelId={manualModelId}
              onManualModelIdChange={onManualModelIdChange}
              onAddManualModel={onAddManualModel}
            />
            {form.fetchModelsError && (
              <p className="text-sm text-muted-foreground">{form.fetchModelsError}</p>
            )}
          </div>
        )}

        {/* Visibility — segmented toggle (Built-in only). */}
        {showVisibility && (
          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
              {(['public', 'private'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => patchForm({ visibility: v })}
                  className={cn(
                    'rounded-[5px] px-4 py-1 text-sm font-medium capitalize transition-colors',
                    form.visibility === v
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {form.visibility === 'public'
                ? 'Public providers are usable by every member.'
                : 'Private providers stay hidden from other members.'}
            </p>
          </div>
        )}

        {/* Connection — test + fetch actions and their result. */}
        <div className="space-y-1.5">
          <Label>Connection</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={form.testing || !testReady}
              onClick={onTest}
              title={
                testReady
                  ? undefined
                  : isOauth
                    ? 'Enter a token first'
                    : 'Fill base URL, API key, and select a model first'
              }
            >
              <Zap className="mr-1 h-3.5 w-3.5" />
              {form.testing ? 'Testing…' : 'Test connection'}
            </Button>
            {!isOauth && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={form.fetchingModels || !fetchReady}
                onClick={onFetchModels}
                title={
                  fetchReady ? 'Probe the /models endpoint' : 'Fill base URL and API key first'
                }
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {form.fetchingModels ? 'Fetching…' : 'Fetch models'}
              </Button>
            )}
            {form.testResult && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-sm',
                  form.testResult.ok ? 'text-success' : 'text-destructive',
                )}
              >
                {form.testResult.ok && <Check className="h-3.5 w-3.5" />}
                {form.testResult.ok ? 'OK' : (form.testResult.error ?? 'Connection failed')}
              </span>
            )}
          </div>
        </div>
      </div>

      {saveError && <p className="px-5 pb-2 text-sm text-destructive">{saveError}</p>}

      {/* Footer — pinned action bar, mirrors the dialog footer in the mock. */}
      <footer className="flex items-center justify-between gap-3 border-t border-border bg-card-2 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          Test connection before saving credential changes.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={saving || (credentialDirty && !form.tested)}
            onClick={onSave}
            title={credentialDirty && !form.tested ? 'Run a successful test first' : undefined}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
