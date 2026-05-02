import { useEffect, useMemo, useState } from 'react';
import type {
  HookEntry,
  KimiConfigDTO,
  KimiConfigPatchDTO,
  KimiConfigStatusResponse,
  KimiConfigTestResponse,
  ModelCapability,
  ModelEntry,
  ProviderType,
} from 'shared/types/kimi-config';
import {
  fetchConfig,
  fetchConfigStatus,
  patchConfig,
  testConfigConnection,
} from '../../api/kimi-config';
import { cn } from '../../lib/utils';

const PROVIDER_TYPES: ProviderType[] = [
  'kimi',
  'openai_legacy',
  'openai_responses',
  'anthropic',
  'gemini',
  'vertexai',
];

const CAPABILITIES: ModelCapability[] = ['thinking', 'always_thinking', 'image_in', 'video_in'];

const DEFAULT_LOOP_CONTROL = {
  maxStepsPerTurn: 50,
  maxRetriesPerStep: 3,
  maxRalphIterations: 10,
  reservedContextSize: 4096,
  compactionTriggerRatio: 0.8,
};

const DEFAULT_BACKGROUND = {
  maxRunningTasks: 10,
  readMaxBytes: 1048576,
  notificationTailLines: 20,
  notificationTailChars: 2000,
  waitPollIntervalMs: 1000,
  workerHeartbeatIntervalMs: 30000,
  workerStaleAfterMs: 120000,
  killGracePeriodMs: 5000,
  keepAliveOnExit: false,
  agentTaskTimeoutS: 300,
  printWaitCeilingS: 10,
};

function emptyConfig(): KimiConfigDTO {
  return {
    defaults: {
      model: '',
      thinking: false,
      yolo: false,
      planMode: false,
      editor: '',
      theme: 'dark',
      showThinkingStream: false,
      skipAfkPromptInjection: false,
      mergeAllAvailableSkills: false,
      extraSkillDirs: [],
      telemetry: false,
    },
    provider: {
      name: '',
      type: 'kimi',
      baseUrl: '',
      apiKey: '',
      env: {},
      customHeaders: {},
    },
    models: {},
    services: { search: null, fetch: null },
    loopControl: { ...DEFAULT_LOOP_CONTROL },
    background: { ...DEFAULT_BACKGROUND },
    notifications: { claimStaleAfterMs: 300000 },
    mcpClient: { toolCallTimeoutMs: 60000 },
    hooks: [],
    extraTomlOverride: '',
    updatedAt: '',
  };
}

// ─── Reusable UI primitives ───────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-slate-200 rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
        props.className,
      )}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white',
        props.className,
      )}
    />
  );
}

function Checkbox({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
      <input
        type="checkbox"
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        {...props}
      />
      {label}
    </label>
  );
}

function NumberInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <Input {...props} type="number" />;
}

// ─── Key-value table editor ───────────────────────────────────────

function KeyValueEditor({
  label,
  data,
  onChange,
}: {
  label: string;
  data: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const entries = useMemo(() => Object.entries(data), [data]);

  function update(idx: number, key: string, value: string) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      next[i === idx ? key : k] = i === idx ? value : v;
    });
    onChange(next);
  }

  function remove(idx: number) {
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      if (i !== idx) next[k] = v;
    });
    onChange(next);
  }

  function add() {
    onChange({ ...data, '': '' });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <button
          type="button"
          onClick={add}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          + Add
        </button>
      </div>
      {entries.length === 0 && <p className="text-xs text-slate-400 italic">None</p>}
      {entries.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries shift on edit, index is stable enough for admin settings
        <div key={i} className="flex gap-2">
          <Input
            value={k}
            placeholder="key"
            onChange={(e) => update(i, e.target.value, v)}
            className="flex-1"
          />
          <Input
            value={v}
            placeholder="value"
            onChange={(e) => update(i, k, e.target.value)}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-xs text-red-600 hover:text-red-800 px-2"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────

export function KimiConfigPage() {
  const [config, setConfig] = useState<KimiConfigDTO | null>(null);
  const [status, setStatus] = useState<KimiConfigStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<KimiConfigTestResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState(false);
  const [replaceKey, setReplaceKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, st] = await Promise.all([fetchConfig(), fetchConfigStatus()]);
        if (!cancelled) {
          setConfig(cfg);
          setStatus(st);
        }
      } catch (e) {
        if (!cancelled) setToast(e instanceof Error ? e.message : 'Failed to load config');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const draft = config ?? emptyConfig();

  function updateProvider(p: Partial<typeof draft.provider>) {
    if (!config) return;
    setConfig({ ...config, provider: { ...config.provider, ...p } });
  }

  function updateDefaults(d: Partial<typeof draft.defaults>) {
    if (!config) return;
    setConfig({ ...config, defaults: { ...config.defaults, ...d } });
  }

  function updateServices(s: Partial<typeof draft.services>) {
    if (!config) return;
    setConfig({ ...config, services: { ...config.services, ...s } });
  }

  function updateLoopControl(l: Partial<typeof draft.loopControl>) {
    if (!config) return;
    setConfig({ ...config, loopControl: { ...config.loopControl, ...l } });
  }

  function updateBackground(b: Partial<typeof draft.background>) {
    if (!config) return;
    setConfig({ ...config, background: { ...config.background, ...b } });
  }

  function updateNotifications(n: Partial<typeof draft.notifications>) {
    if (!config) return;
    setConfig({ ...config, notifications: { ...config.notifications, ...n } });
  }

  function updateMcpClient(m: Partial<typeof draft.mcpClient>) {
    if (!config) return;
    setConfig({ ...config, mcpClient: { ...config.mcpClient, ...m } });
  }

  function updateModel(id: string, entry: Partial<ModelEntry>) {
    if (!config) return;
    const next = { ...config.models };
    if (next[id]) next[id] = { ...next[id], ...entry };
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

  function updateHook(idx: number, h: Partial<HookEntry>) {
    if (!config) return;
    const next = [...config.hooks];
    const existing = next[idx];
    if (!existing) return;
    next[idx] = {
      event: h.event ?? existing.event,
      command: h.command ?? existing.command,
      matcher: 'matcher' in h ? h.matcher : existing.matcher,
      timeout: 'timeout' in h ? h.timeout : existing.timeout,
    };
    setConfig({ ...config, hooks: next });
  }

  function addHook() {
    if (!config) return;
    setConfig({ ...config, hooks: [...config.hooks, { event: '', command: '' }] });
  }

  function removeHook(idx: number) {
    if (!config) return;
    const next = [...config.hooks];
    next.splice(idx, 1);
    setConfig({ ...config, hooks: next });
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const patch: KimiConfigPatchDTO = {
        defaults: config.defaults,
        provider: {
          ...config.provider,
          apiKey: replaceKey ? config.provider.apiKey : (null as unknown as string),
        },
        models: config.models,
        services: config.services,
        loopControl: config.loopControl,
        background: config.background,
        notifications: config.notifications,
        mcpClient: config.mcpClient,
        hooks: config.hooks,
        extraTomlOverride: config.extraTomlOverride,
      };
      const updated = await patchConfig(patch);
      setConfig(updated);
      setReplaceKey(false);
      setToast('Saved successfully');
      const st = await fetchConfigStatus();
      setStatus(st);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConfigConnection();
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-slate-500">Loading settings…</span>
      </div>
    );
  }

  const modelIds = Object.keys(draft.models);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Kimi Configuration</h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {status && (
            <>
              <span
                className={cn(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                  status.ready ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
                )}
              >
                {status.ready ? 'Ready' : 'Not Ready'}
              </span>
              <span className="text-slate-600">Auth: {status.authMode}</span>
              {status.missing.length > 0 && (
                <span className="text-red-600">Missing: {status.missing.join(', ')}</span>
              )}
            </>
          )}
          {testResult && (
            <span className={testResult.ok ? 'text-green-700' : 'text-red-700'}>
              {testResult.ok ? 'Connection OK' : `Connection failed: ${testResult.error}`}
            </span>
          )}
        </div>

        {/* Provider */}
        <Section title="Provider">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="provider-type">Type</Label>
              <Select
                id="provider-type"
                value={draft.provider.type}
                onChange={(e) => updateProvider({ type: e.target.value as ProviderType })}
              >
                {PROVIDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={draft.provider.name}
                onChange={(e) => updateProvider({ name: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="provider-baseUrl">Base URL</Label>
              <Input
                id="provider-baseUrl"
                value={draft.provider.baseUrl}
                onChange={(e) => updateProvider({ baseUrl: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="provider-apiKey">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="provider-apiKey"
                  type={revealKey ? 'text' : 'password'}
                  value={draft.provider.apiKey}
                  onChange={(e) => updateProvider({ apiKey: e.target.value })}
                  placeholder={replaceKey ? 'Enter new API key' : '••••••••'}
                  disabled={!replaceKey && draft.provider.apiKey === ''}
                />
                <button
                  type="button"
                  onClick={() => setRevealKey((v) => !v)}
                  className="px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  {revealKey ? 'Hide' : 'Reveal'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplaceKey((v) => !v);
                    if (!replaceKey) setRevealKey(true);
                  }}
                  className="px-3 py-2 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  {replaceKey ? 'Cancel' : 'Replace'}
                </button>
              </div>
            </div>
          </div>
          <KeyValueEditor
            label="Environment Variables"
            data={draft.provider.env}
            onChange={(env) => updateProvider({ env })}
          />
          <KeyValueEditor
            label="Custom Headers"
            data={draft.provider.customHeaders}
            onChange={(customHeaders) => updateProvider({ customHeaders })}
          />
        </Section>

        {/* Models */}
        <Section title="Models">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Default Model</span>
              <Select
                value={draft.defaults.model}
                onChange={(e) => updateDefaults({ model: e.target.value })}
                className="w-auto min-w-[12rem]"
              >
                <option value="">— Select —</option>
                {modelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-slate-200 rounded-lg">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">ID</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Provider</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Model</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Context</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Capabilities</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Display Name</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {modelIds.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-slate-400 italic">
                        No models configured
                      </td>
                    </tr>
                  )}
                  {modelIds.map((id) => {
                    const m = draft.models[id];
                    if (!m) return null;
                    return (
                      <tr key={id}>
                        <td className="px-3 py-2">
                          <Input value={id} disabled className="bg-slate-50" />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={m.provider}
                            onChange={(e) => updateModel(id, { provider: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={m.model}
                            onChange={(e) => updateModel(id, { model: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput
                            value={m.maxContextSize}
                            onChange={(e) =>
                              updateModel(id, { maxContextSize: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {CAPABILITIES.map((cap) => (
                              <label
                                key={cap}
                                className="flex items-center gap-1 text-xs text-slate-700 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={m.capabilities.includes(cap)}
                                  onChange={(e) => {
                                    const caps = e.target.checked
                                      ? [...m.capabilities, cap]
                                      : m.capabilities.filter((c) => c !== cap);
                                    updateModel(id, { capabilities: caps });
                                  }}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                {cap}
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={m.displayName ?? ''}
                            onChange={(e) => updateModel(id, { displayName: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removeModel(id)}
                            className="text-xs text-red-600 hover:text-red-800"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addModel}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              + Add Model
            </button>
          </div>
        </Section>

        {/* Defaults */}
        <Section title="Defaults">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Checkbox
              label="Thinking"
              checked={draft.defaults.thinking}
              onChange={(e) => updateDefaults({ thinking: e.target.checked })}
            />
            <Checkbox
              label="YOLO"
              checked={draft.defaults.yolo}
              onChange={(e) => updateDefaults({ yolo: e.target.checked })}
            />
            <Checkbox
              label="Plan Mode"
              checked={draft.defaults.planMode}
              onChange={(e) => updateDefaults({ planMode: e.target.checked })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="default-theme">Theme</Label>
              <Select
                id="default-theme"
                value={draft.defaults.theme}
                onChange={(e) => updateDefaults({ theme: e.target.value as 'dark' | 'light' })}
              >
                <option value="dark">dark</option>
                <option value="light">light</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="default-editor">Editor</Label>
              <Input
                id="default-editor"
                value={draft.defaults.editor}
                onChange={(e) => updateDefaults({ editor: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Checkbox
              label="Show Thinking Stream"
              checked={draft.defaults.showThinkingStream}
              onChange={(e) => updateDefaults({ showThinkingStream: e.target.checked })}
            />
            <Checkbox
              label="Skip AFK Prompt Injection"
              checked={draft.defaults.skipAfkPromptInjection}
              onChange={(e) => updateDefaults({ skipAfkPromptInjection: e.target.checked })}
            />
            <Checkbox
              label="Merge All Available Skills"
              checked={draft.defaults.mergeAllAvailableSkills}
              onChange={(e) => updateDefaults({ mergeAllAvailableSkills: e.target.checked })}
            />
            <Checkbox
              label="Telemetry"
              checked={draft.defaults.telemetry}
              onChange={(e) => updateDefaults({ telemetry: e.target.checked })}
            />
          </div>
          <div>
            <Label htmlFor="extra-skill-dirs">Extra Skill Dirs</Label>
            <div className="space-y-2">
              {draft.defaults.extraSkillDirs.map((dir, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: admin settings, index is stable
                <div key={i} className="flex gap-2">
                  <Input
                    value={dir}
                    onChange={(e) => {
                      const next = [...draft.defaults.extraSkillDirs];
                      next[i] = e.target.value;
                      updateDefaults({ extraSkillDirs: next });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...draft.defaults.extraSkillDirs];
                      next.splice(i, 1);
                      updateDefaults({ extraSkillDirs: next });
                    }}
                    className="text-xs text-red-600 hover:text-red-800 px-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  updateDefaults({ extraSkillDirs: [...draft.defaults.extraSkillDirs, ''] })
                }
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Add Directory
              </button>
            </div>
          </div>
        </Section>

        {/* Services */}
        <Section title="Services">
          <div className="space-y-4">
            {/* Search */}
            <div className="border border-slate-200 rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Search</span>
                <Checkbox
                  label="Enabled"
                  checked={draft.services.search !== null}
                  onChange={(e) =>
                    updateServices({
                      search: e.target.checked ? { baseUrl: '', apiKey: '' } : null,
                    } as Partial<typeof draft.services>)
                  }
                />
              </div>
              {draft.services.search && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Base URL</Label>
                    <Input
                      value={draft.services.search.baseUrl}
                      onChange={(e) =>
                        updateServices({
                          search: {
                            ...draft.services.search,
                            baseUrl: e.target.value,
                          } as NonNullable<typeof draft.services.search>,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>API Key</Label>
                    <Input
                      type="password"
                      value={draft.services.search.apiKey}
                      onChange={(e) =>
                        updateServices({
                          search: {
                            ...draft.services.search,
                            apiKey: e.target.value,
                          } as NonNullable<typeof draft.services.search>,
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Fetch */}
            <div className="border border-slate-200 rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Fetch</span>
                <Checkbox
                  label="Enabled"
                  checked={draft.services.fetch !== null}
                  onChange={(e) =>
                    updateServices({
                      fetch: e.target.checked ? { baseUrl: '', apiKey: '' } : null,
                    } as Partial<typeof draft.services>)
                  }
                />
              </div>
              {draft.services.fetch && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Base URL</Label>
                    <Input
                      value={draft.services.fetch.baseUrl}
                      onChange={(e) =>
                        updateServices({
                          fetch: {
                            ...draft.services.fetch,
                            baseUrl: e.target.value,
                          } as NonNullable<typeof draft.services.fetch>,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>API Key</Label>
                    <Input
                      type="password"
                      value={draft.services.fetch.apiKey}
                      onChange={(e) =>
                        updateServices({
                          fetch: { ...draft.services.fetch, apiKey: e.target.value } as NonNullable<
                            typeof draft.services.fetch
                          >,
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Loop Control */}
        <Section title="Loop Control">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">Reset all to defaults</span>
            <button
              type="button"
              onClick={() => updateLoopControl({ ...DEFAULT_LOOP_CONTROL })}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Max Steps Per Turn</Label>
              <NumberInput
                value={draft.loopControl.maxStepsPerTurn}
                onChange={(e) => updateLoopControl({ maxStepsPerTurn: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Max Retries Per Step</Label>
              <NumberInput
                value={draft.loopControl.maxRetriesPerStep}
                onChange={(e) => updateLoopControl({ maxRetriesPerStep: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Max Ralph Iterations</Label>
              <NumberInput
                value={draft.loopControl.maxRalphIterations}
                onChange={(e) => updateLoopControl({ maxRalphIterations: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Reserved Context Size</Label>
              <NumberInput
                value={draft.loopControl.reservedContextSize}
                onChange={(e) => updateLoopControl({ reservedContextSize: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Compaction Trigger Ratio</Label>
              <NumberInput
                value={draft.loopControl.compactionTriggerRatio}
                step={0.1}
                onChange={(e) =>
                  updateLoopControl({ compactionTriggerRatio: Number(e.target.value) })
                }
              />
            </div>
          </div>
        </Section>

        {/* Background */}
        <Section title="Background">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Max Running Tasks</Label>
              <NumberInput
                value={draft.background.maxRunningTasks}
                onChange={(e) => updateBackground({ maxRunningTasks: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Read Max Bytes</Label>
              <NumberInput
                value={draft.background.readMaxBytes}
                onChange={(e) => updateBackground({ readMaxBytes: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Notification Tail Lines</Label>
              <NumberInput
                value={draft.background.notificationTailLines}
                onChange={(e) =>
                  updateBackground({ notificationTailLines: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Notification Tail Chars</Label>
              <NumberInput
                value={draft.background.notificationTailChars}
                onChange={(e) =>
                  updateBackground({ notificationTailChars: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Wait Poll Interval (ms)</Label>
              <NumberInput
                value={draft.background.waitPollIntervalMs}
                onChange={(e) => updateBackground({ waitPollIntervalMs: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Worker Heartbeat (ms)</Label>
              <NumberInput
                value={draft.background.workerHeartbeatIntervalMs}
                onChange={(e) =>
                  updateBackground({ workerHeartbeatIntervalMs: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label>Worker Stale After (ms)</Label>
              <NumberInput
                value={draft.background.workerStaleAfterMs}
                onChange={(e) => updateBackground({ workerStaleAfterMs: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Kill Grace Period (ms)</Label>
              <NumberInput
                value={draft.background.killGracePeriodMs}
                onChange={(e) => updateBackground({ killGracePeriodMs: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Agent Task Timeout (s)</Label>
              <NumberInput
                value={draft.background.agentTaskTimeoutS}
                onChange={(e) => updateBackground({ agentTaskTimeoutS: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Print Wait Ceiling (s)</Label>
              <NumberInput
                value={draft.background.printWaitCeilingS}
                onChange={(e) => updateBackground({ printWaitCeilingS: Number(e.target.value) })}
              />
            </div>
            <div className="md:col-span-3">
              <Checkbox
                label="Keep Alive On Exit"
                checked={draft.background.keepAliveOnExit}
                onChange={(e) => updateBackground({ keepAliveOnExit: e.target.checked })}
              />
            </div>
          </div>
        </Section>

        {/* Notifications + MCP */}
        <Section title="Notifications & MCP">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Claim Stale After (ms)</Label>
              <NumberInput
                value={draft.notifications.claimStaleAfterMs}
                onChange={(e) => updateNotifications({ claimStaleAfterMs: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Tool Call Timeout (ms)</Label>
              <NumberInput
                value={draft.mcpClient.toolCallTimeoutMs}
                onChange={(e) => updateMcpClient({ toolCallTimeoutMs: Number(e.target.value) })}
              />
            </div>
          </div>
        </Section>

        {/* Hooks */}
        <Section title="Hooks">
          <div className="space-y-2">
            {draft.hooks.length === 0 && (
              <p className="text-xs text-slate-400 italic">No hooks configured</p>
            )}
            {draft.hooks.map((h, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: admin settings, index is stable
                key={i}
                className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border border-slate-200 rounded-md p-3"
              >
                <div>
                  <Label>Event</Label>
                  <Input
                    value={h.event}
                    onChange={(e) => updateHook(i, { event: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Command</Label>
                  <Input
                    value={h.command}
                    onChange={(e) => updateHook(i, { command: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Matcher</Label>
                  <Input
                    value={h.matcher ?? ''}
                    onChange={(e) => updateHook(i, { matcher: e.target.value || undefined })}
                  />
                </div>
                <div>
                  <Label>Timeout</Label>
                  <NumberInput
                    value={h.timeout ?? ''}
                    onChange={(e) =>
                      updateHook(i, {
                        timeout: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => removeHook(i)}
                    className="text-xs text-red-600 hover:text-red-800 px-2 py-2"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addHook}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              + Add Hook
            </button>
          </div>
        </Section>

        {/* Extra TOML */}
        <Section title="Extra TOML Override">
          <textarea
            value={draft.extraTomlOverride}
            onChange={(e) =>
              setConfig((c) => (c ? { ...c, extraTomlOverride: e.target.value } : c))
            }
            rows={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Section>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-2 rounded-md shadow-lg text-sm font-medium bg-slate-900 text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
