import type { ModelCapability, ModelEntry } from 'shared/types/kimi-config';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { useKimiConfigStore } from '../../lib/kimi-config-store';

const CAPABILITIES: ModelCapability[] = ['thinking', 'always_thinking', 'image_in', 'video_in'];

export function ModelsPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const setConfig = useKimiConfigStore((s) => s.setConfig);
  const patch = useKimiConfigStore((s) => s.patch);

  if (!config) return null;

  const modelIds = Object.keys(config.models);
  const defaultModel = config.defaults.model;
  const defaultMissing = defaultModel !== '' && !(defaultModel in config.models);

  function updateModel(id: string, entry: Partial<ModelEntry>) {
    if (!config) return;
    const existing = config.models[id];
    if (!existing) return;
    const next = { ...config.models, [id]: { ...existing, ...entry } };
    setConfig({ ...config, models: next });
  }

  function addModel() {
    if (!config) return;
    const id = `model-${Date.now()}`;
    setConfig({
      ...config,
      models: {
        ...config.models,
        [id]: {
          provider: config.provider.name || '',
          model: '',
          maxContextSize: 8192,
          capabilities: [],
          displayName: '',
        },
      },
    });
  }

  function removeModel(id: string) {
    if (!config) return;
    const next = { ...config.models };
    delete next[id];
    setConfig({ ...config, models: next });
  }

  return (
    <Section
      title="Models"
      description="Register the model entries the agent can route to."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={addModel}>
          + Add model
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Default model</p>
          <p className="text-xs text-muted-foreground">Used when a session has no override.</p>
        </div>
        <Select
          value={defaultModel}
          onChange={(e) => patch({ defaults: { model: e.target.value } })}
          className="w-auto min-w-[14rem]"
        >
          <option value="">— Select —</option>
          {modelIds.map((id) => (
            <option key={id} value={id}>
              {config.models[id]?.displayName || id}
            </option>
          ))}
        </Select>
      </div>

      {defaultMissing && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Default model <code className="font-mono">{defaultModel}</code> is not in the registry
          below. Add it or pick a different default.
        </p>
      )}

      {modelIds.length === 0 ? (
        <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
          No models registered yet.
        </p>
      ) : (
        <div className="space-y-3">
          {modelIds.map((id) => {
            const m = config.models[id];
            if (!m) return null;
            return (
              <ModelRow
                key={id}
                id={id}
                entry={m}
                onChange={(p) => updateModel(id, p)}
                onRemove={() => removeModel(id)}
              />
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ModelRow({
  id,
  entry,
  onChange,
  onRemove,
}: {
  id: string;
  entry: ModelEntry;
  onChange: (p: Partial<ModelEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded truncate max-w-[260px]">
          {id}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onRemove}
          className="text-destructive hover:text-destructive"
        >
          Remove
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Provider</Label>
          <Input
            value={entry.provider}
            placeholder="managed:kimi-code"
            onChange={(e) => onChange({ provider: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Model id</Label>
          <Input
            value={entry.model}
            placeholder="kimi-for-coding"
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Max context size</Label>
          <Input
            type="number"
            min={0}
            value={entry.maxContextSize}
            onChange={(e) => onChange({ maxContextSize: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2 space-y-1">
          <Label>Capabilities</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            {CAPABILITIES.map((cap) => (
              <label
                key={cap}
                className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
              >
                <Checkbox
                  checked={entry.capabilities.includes(cap)}
                  onChange={(e) => {
                    const caps = e.target.checked
                      ? [...entry.capabilities, cap]
                      : entry.capabilities.filter((c) => c !== cap);
                    onChange({ capabilities: caps });
                  }}
                />
                {cap}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label>Display name</Label>
          <Input
            value={entry.displayName ?? ''}
            placeholder="Kimi Coding Engine"
            onChange={(e) => onChange({ displayName: e.target.value })}
          />
        </div>
      </div>

      <details className="rounded-md border border-border bg-muted/20">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted-foreground">
          Generation params (optional)
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border-t border-border">
          <OptionalNumber
            label="Temperature"
            value={entry.temperature}
            onChange={(v) => onChange({ temperature: v })}
            step={0.01}
            min={0}
            max={2}
            placeholder="0.7"
          />
          <OptionalNumber
            label="Top P"
            value={entry.topP}
            onChange={(v) => onChange({ topP: v })}
            step={0.01}
            min={0}
            max={1}
            placeholder="0.95"
          />
          <OptionalNumber
            label="Max output tokens"
            value={entry.maxTokens}
            onChange={(v) => onChange({ maxTokens: v })}
            step={1}
            min={0}
            placeholder="4096"
          />
        </div>
      </details>
    </div>
  );
}

function OptionalNumber({
  label,
  value,
  onChange,
  step,
  min,
  max,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
      />
    </div>
  );
}
