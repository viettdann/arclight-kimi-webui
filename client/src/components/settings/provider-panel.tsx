import { useState } from 'react';
import { isProviderType, PROVIDER_TYPES, type ProviderType } from 'shared/types/kimi-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { useKimiConfigStore } from '../../lib/kimi-config-store';
import { KeyValueEditor } from './key-value-editor';
import { ModelsPanel } from './models-panel';

const TYPE_HINTS: Record<ProviderType, string> = {
  kimi: 'Kimi API platforms (Kimi Code, platform.kimi.com, platform.kimi.ai). API key required (`sk-...`).',
  openai_legacy:
    'OpenAI Chat Completions API and compatible providers (DeepSeek, Mistral, local OpenAI-compatible servers).',
  openai_responses:
    'OpenAI Responses API (newer format) and compatible providers.',
  anthropic:
    'Anthropic Claude API and compatible providers (e.g. proxies using Anthropic schema). Environment variable overrides are not supported — config file is the only source.',
};

export function ProviderPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const patch = useKimiConfigStore((s) => s.patch);
  const replaceKey = useKimiConfigStore((s) => s.replaceKey);
  const setReplaceKey = useKimiConfigStore((s) => s.setReplaceKey);
  const [revealKey, setRevealKey] = useState(false);

  if (!config) return <PanelSkeleton />;
  const p = config.provider;

  return (
    <div className="space-y-6">
      <Section
        title="Credentials"
        description="Configure the upstream API the agent calls."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider-type">Provider type</Label>
            <Select
              id="provider-type"
              value={p.type}
              onChange={(e) => {
                const next = e.target.value;
                if (isProviderType(next)) patch({ provider: { type: next } });
              }}
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{TYPE_HINTS[p.type]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">Identifier name</Label>
            <Input
              id="provider-name"
              value={p.name}
              placeholder="e.g. managed:kimi-code"
              onChange={(e) => patch({ provider: { name: e.target.value } })}
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="provider-baseUrl">Base URL</Label>
            <Input
              id="provider-baseUrl"
              value={p.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => patch({ provider: { baseUrl: e.target.value } })}
            />
            <p className="text-xs text-muted-foreground">
              Test Connection probes <code className="font-mono">{'{baseUrl}'}/v1/models</code> —
              trailing <code className="font-mono">/v1</code> is auto-appended if missing.
            </p>
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="provider-apiKey">API key</Label>
            <div className="flex gap-2">
              <Input
                id="provider-apiKey"
                type={revealKey ? 'text' : 'password'}
                value={p.apiKey}
                onChange={(e) => patch({ provider: { apiKey: e.target.value } })}
                placeholder={replaceKey ? 'Enter new API key' : '••••••••'}
                disabled={!replaceKey && p.apiKey === ''}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevealKey((v) => !v)}
              >
                {revealKey ? 'Hide' : 'Reveal'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = !replaceKey;
                  setReplaceKey(next);
                  if (next) setRevealKey(true);
                }}
              >
                {replaceKey ? 'Cancel' : 'Replace'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Existing key is left unchanged on save unless <strong>Replace</strong> is engaged.
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-4 space-y-4">
          <KeyValueEditor
            label="Environment overrides"
            description="Extra env vars injected when launching the agent."
            data={p.env}
            onChange={(env) => patch({ provider: { env } })}
            keyPlaceholder="KEY"
            valuePlaceholder="value"
          />
          <KeyValueEditor
            label="Custom HTTP headers"
            description="Sent with every request to the provider."
            data={p.customHeaders}
            onChange={(customHeaders) => patch({ provider: { customHeaders } })}
            keyPlaceholder="X-Header"
            valuePlaceholder="value"
          />
        </div>
      </Section>

      <ModelsPanel />
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
