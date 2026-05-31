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
}: ProviderFormProps) {
  const credentialDirty = isCredentialDirty({
    token: form.token,
    baseUrl: form.baseUrl,
    savedBaseUrl: existingProvider?.baseUrl ?? '',
  });

  // Fetch needs base URL + key; Test additionally needs a model to ping.
  const { fetchReady } = probeReadiness(form.token, form.baseUrl, isEdit);
  const testReady = fetchReady && form.models.length > 0;

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

      {/* API Key and Models share one row. Models is always available — pick
          from fetched options or add manually. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
        <SecretField
          id="pf-token"
          label="API Key"
          masked={existingProvider?.tokenMasked ?? ''}
          isSet={isEdit && !!existingProvider}
          value={form.token}
          onChange={(v) => patchForm({ token: v })}
          placeholder="Enter API key"
        />
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
      </div>

      {/* Test + fetch-models actions */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={form.testing || !testReady}
          onClick={onTest}
          title={testReady ? undefined : 'Fill base URL, API key, and select a model first'}
        >
          {form.testing ? 'Testing…' : 'Test connection'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={form.fetchingModels || !fetchReady}
          onClick={onFetchModels}
          title={fetchReady ? 'Probe the /models endpoint' : 'Fill base URL and API key first'}
        >
          {form.fetchingModels ? 'Fetching…' : 'Fetch models'}
        </Button>
        {form.testResult && (
          <span
            className={
              form.testResult.ok
                ? 'text-sm text-emerald-600 dark:text-emerald-400'
                : 'text-sm text-destructive'
            }
          >
            {form.testResult.ok ? 'OK' : (form.testResult.error ?? 'Connection failed')}
          </span>
        )}
      </div>

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

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div className="flex items-center justify-end gap-2">
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
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
