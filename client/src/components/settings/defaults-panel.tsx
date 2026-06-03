import { useEffect, useMemo } from 'react';
import {
  APPROVAL_MODES,
  type ApprovalMode,
  EFFORT_OPTIONS,
  type EffortLevel,
  effortLabel,
} from 'shared/types';
import { SecHead } from '@/components/ui/sec-head';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { isResolvable, labelFor, useProvidersStore } from '../../lib/providers-store';
import { useSessionDefaultsStore } from '../../lib/session-defaults-store';
import { cn } from '../../lib/utils';
import { useRegisterDirty } from './use-settings-dirty';

export const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  ask: 'Ask — confirm every tool call',
  safe: 'Safe — auto-approve read-only tools',
  bypass: 'Bypass — auto-approve everything',
};

type Source = 'user' | 'site' | 'code';

function sourceLabel(source: Source): string {
  switch (source) {
    case 'user':
      return 'Your override';
    case 'site':
      return 'Site default';
    case 'code':
      return 'Code default';
  }
}

function sourceBadgeClass(source: Source): string {
  switch (source) {
    case 'user':
      return 'bg-primary-wash text-primary-hover';
    case 'site':
      return 'bg-warning-wash text-warning';
    case 'code':
      return 'bg-muted text-muted-foreground';
  }
}

export function DefaultsPanel() {
  const store = useSessionDefaultsStore();
  const { available, ensureLoaded } = useProvidersStore();

  useRegisterDirty('session-defaults', store.saveFailed);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    ensureLoaded();
    if (store.status === 'idle') void store.load();
  }, []);

  const {
    approvalMode,
    thinking,
    providerId,
    model,
    effort,
    isUserOverride,
    setApprovalMode,
    setThinking,
    setProviderId,
    setModel,
    setEffort,
    resetApprovalMode,
    resetThinking,
    resetProviderId,
    resetModel,
    resetEffort,
  } = store;

  // Source determination
  const thinkingSource: Source = isUserOverride.thinking
    ? 'user'
    : thinking !== true
      ? 'site'
      : 'code';
  const approvalSource: Source = isUserOverride.approvalMode
    ? 'user'
    : approvalMode !== 'ask'
      ? 'site'
      : 'code';
  const providerSource: Source = isUserOverride.providerId ? 'user' : 'code';
  const modelSource: Source = isUserOverride.model ? 'user' : 'code';
  const effortSource: Source = isUserOverride.effort ? 'user' : 'code';

  const allProviders = [...(available?.builtin ?? []), ...(available?.personal ?? [])];

  const selectedProvider = useMemo(
    () => allProviders.find((p) => p.id === providerId),
    [allProviders, providerId],
  );
  const selectedModel = useMemo(
    () => selectedProvider?.models.find((m) => m.modelId === model) ?? null,
    [selectedProvider, model],
  );

  const modelLabel = useMemo(
    () => labelFor(available, providerId, model) ?? 'Select a model',
    [available, providerId, model],
  );

  // Build a Map for O(1) model→provider resolution on selection change.
  const modelToProvider = useMemo(() => {
    const m = new Map<string, { providerId: string; modelId: string }>();
    for (const provider of allProviders) {
      for (const mod of provider.models) {
        m.set(mod.modelId, { providerId: provider.id, modelId: mod.modelId });
      }
    }
    return m;
  }, [allProviders]);

  return (
    <div className="space-y-4">
      {/* Model / Provider */}
      <SettingRow
        title="Model"
        description="Default model for new sessions."
        source={modelSource}
        onReset={isUserOverride.model ? resetModel : undefined}
      >
        <Select
          id="default-model"
          value={model ?? ''}
          onChange={(e) => {
            const modelId = e.target.value;
            if (!modelId) return;
            const found = modelToProvider.get(modelId);
            if (found) {
              setProviderId(found.providerId);
              setModel(found.modelId);
            }
          }}
          className="w-auto min-w-[16rem]"
        >
          <option value="">{modelLabel}</option>
          {available?.builtin && available.builtin.length > 0 && (
            <optgroup label="Built-in">
              {available.builtin.flatMap((provider) =>
                provider.models.map((m) => (
                  <option key={`${provider.id}/${m.modelId}`} value={m.modelId}>
                    {provider.namespace}/{m.displayName ?? m.modelId}
                  </option>
                )),
              )}
            </optgroup>
          )}
          {available?.personal && available.personal.length > 0 && (
            <optgroup label="Personal">
              {available.personal.flatMap((provider) =>
                provider.models.map((m) => (
                  <option key={`${provider.id}/${m.modelId}`} value={m.modelId}>
                    {provider.namespace}/{m.displayName ?? m.modelId}
                  </option>
                )),
              )}
            </optgroup>
          )}
        </Select>
      </SettingRow>

      {/* Thinking */}
      <SettingRow
        title="Thinking mode"
        description="Allow extended reasoning before answering."
        source={thinkingSource}
        onReset={isUserOverride.thinking ? resetThinking : undefined}
      >
        <Switch
          checked={thinking}
          onCheckedChange={setThinking}
          aria-labelledby="default-thinking-label"
        />
      </SettingRow>

      {/* Effort */}
      <SettingRow
        title="Reasoning effort"
        description="How much reasoning to apply when thinking is on."
        source={effortSource}
        onReset={isUserOverride.effort ? resetEffort : undefined}
      >
        <Select
          id="default-effort"
          value={effort ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            setEffort(v === '' ? null : (v as EffortLevel));
          }}
          className="w-auto min-w-[10rem]"
        >
          {EFFORT_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value ?? ''}>
              {opt.label}
            </option>
          ))}
        </Select>
      </SettingRow>

      {/* Approval mode */}
      <SettingRow
        title="Approval mode"
        description="How tool calls are confirmed before they run."
        source={approvalSource}
        onReset={isUserOverride.approvalMode ? resetApprovalMode : undefined}
      >
        <Select
          id="default-approval"
          value={approvalMode}
          onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
          className="w-auto min-w-[16rem]"
        >
          {APPROVAL_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {APPROVAL_LABELS[mode]}
            </option>
          ))}
        </Select>
      </SettingRow>
    </div>
  );
}

function SettingRow({
  title,
  description,
  source,
  onReset,
  children,
}: {
  title: string;
  description: string;
  source: Source;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
              sourceBadgeClass(source),
            )}
          >
            {sourceLabel(source)}
          </span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
