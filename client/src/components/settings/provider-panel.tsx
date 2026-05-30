import { useRef, useState } from 'react';
import { CLAUDE_PROVIDERS, type ClaudeProvider, isClaudeProvider } from 'shared/types/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { useConfigStore } from '../../lib/config-store';
import { cn } from '../../lib/utils';

const PROVIDER_LABELS: Record<ClaudeProvider, string> = {
  oauth: 'Claude OAuth token',
  api: 'Anthropic API',
};

const PROVIDER_HINTS: Record<ClaudeProvider, string> = {
  oauth: 'Authenticate with a Claude Code OAuth token (from `claude setup-token`).',
  api: 'Authenticate against an Anthropic-compatible endpoint with an auth token.',
};

export function ProviderPanel() {
  const loadStatus = useConfigStore((s) => s.loadStatus);
  const settings = useConfigStore((s) => s.settings);
  const getValue = useConfigStore((s) => s.getValue);
  const setDraft = useConfigStore((s) => s.setDraft);
  const testing = useConfigStore((s) => s.testing);
  const test = useConfigStore((s) => s.test);

  if (loadStatus !== 'ready') return <PanelSkeleton />;

  const providerRaw = getValue('CLAUDE_PROVIDER');
  const provider: ClaudeProvider = isClaudeProvider(providerRaw) ? providerRaw : 'oauth';

  return (
    <div className="space-y-6">
      <Section title="Provider" description="How the agent authenticates with Claude.">
        <div className="space-y-2">
          <Label>Auth mode</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {CLAUDE_PROVIDERS.map((p) => (
              <label
                key={p}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors',
                  provider === p
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:bg-muted/40',
                )}
              >
                <input
                  type="radio"
                  name="claude-provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setDraft('CLAUDE_PROVIDER', p)}
                  className="mt-0.5"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{PROVIDER_LABELS[p]}</span>
                  <span className="text-xs text-muted-foreground mt-0.5">{PROVIDER_HINTS[p]}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      </Section>

      {provider === 'oauth' ? (
        <Section title="Credentials" description="Claude Code OAuth token.">
          <SecretField
            id="oauth-token"
            label="OAuth token"
            settingKey="CLAUDE_CODE_OAUTH_TOKEN"
            isSet={settings.CLAUDE_CODE_OAUTH_TOKEN?.isSet ?? false}
            getValue={getValue}
            setDraft={setDraft}
            placeholder="Enter Claude OAuth token"
          />
        </Section>
      ) : (
        <Section title="Credentials" description="Anthropic-compatible endpoint.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="base-url">Base URL</Label>
              <Input
                id="base-url"
                value={getValue('ANTHROPIC_BASE_URL')}
                placeholder="https://api.anthropic.com"
                onChange={(e) => setDraft('ANTHROPIC_BASE_URL', e.target.value)}
              />
            </div>
            <SecretField
              id="auth-token"
              label="Auth token"
              settingKey="ANTHROPIC_AUTH_TOKEN"
              isSet={settings.ANTHROPIC_AUTH_TOKEN?.isSet ?? false}
              getValue={getValue}
              setDraft={setDraft}
              placeholder="Enter Anthropic auth token"
            />
            <div className="space-y-1.5">
              <Label htmlFor="anthropic-model">Model</Label>
              <Input
                id="anthropic-model"
                value={getValue('ANTHROPIC_MODEL')}
                placeholder="claude-sonnet-4-6"
                onChange={(e) => setDraft('ANTHROPIC_MODEL', e.target.value)}
              />
            </div>
          </div>
        </Section>
      )}

      <Section
        title="Test connection"
        description="Run a one-shot query to validate the current saved credentials."
      >
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing}
            onClick={() => void test()}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <TestResult />
        </div>
      </Section>
    </div>
  );
}

function TestResult() {
  const testResult = useConfigStore((s) => s.testResult);
  if (!testResult) return null;
  return testResult.ok ? (
    <span className="text-sm text-emerald-600 dark:text-emerald-400">Connection OK</span>
  ) : (
    <span className="text-sm text-destructive">{testResult.error ?? 'Connection failed'}</span>
  );
}

/**
 * Secret field with mask → replace → reveal flow. When the value is already set
 * server-side, shows a masked placeholder until the user clicks Replace, which
 * stages a new plaintext value. Cancel reverts to "leave unchanged" (null).
 */
function SecretField({
  id,
  label,
  settingKey,
  isSet,
  getValue,
  setDraft,
  placeholder,
}: {
  id: string;
  label: string;
  settingKey: string;
  isSet: boolean;
  getValue: (key: string) => string;
  setDraft: (key: string, value: string | null) => void;
  placeholder?: string;
}) {
  const clearDraft = useConfigStore((s) => s.clearDraft);
  const drafts = useConfigStore((s) => s.drafts);
  // True once the user has staged a new value (draft holds a string, not null).
  const editing = typeof drafts[settingKey] === 'string';
  const [reveal, setReveal] = useState(false);
  const masked = useRef(getValue(settingKey)); // server-masked string for display

  function enterReplace() {
    setDraft(settingKey, '');
    setReveal(true);
  }

  function cancelReplace() {
    clearDraft(settingKey);
    setReveal(false);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        {editing ? (
          <Input
            id={id}
            type={reveal ? 'text' : 'password'}
            value={getValue(settingKey)}
            placeholder={placeholder}
            autoFocus
            onChange={(e) => setDraft(settingKey, e.target.value)}
          />
        ) : (
          <Input
            id={id}
            type="text"
            value={isSet ? masked.current : ''}
            readOnly
            placeholder={isSet ? undefined : '(not configured)'}
            className="font-mono"
          />
        )}
        {editing && (
          <Button type="button" variant="outline" size="sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? 'Hide' : 'Show'}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (editing ? cancelReplace() : enterReplace())}
        >
          {editing ? 'Cancel' : isSet ? 'Replace' : 'Set'}
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
