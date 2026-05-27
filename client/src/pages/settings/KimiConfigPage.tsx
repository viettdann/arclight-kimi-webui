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
      thinking: true,
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
    <section className="border border-slate-200 rounded-lg p-5 space-y-5 bg-white shadow-sm transition-all hover:shadow-md">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-indigo-600 border-b border-slate-100 pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5"
    >
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder-slate-400 bg-slate-50 hover:bg-slate-100/50 focus:bg-white',
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
        'w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all bg-slate-50 hover:bg-slate-100/50 focus:bg-white cursor-pointer',
        props.className,
      )}
    />
  );
}

function Checkbox({
  label,
  sublabel,
  ...props
}: { label: string; sublabel?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-all select-none">
      <input
        type="checkbox"
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 mt-0.5"
        {...props}
      />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {sublabel && <span className="text-xs text-slate-400 mt-0.5">{sublabel}</span>}
      </div>
    </label>
  );
}

function NumberInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <Input {...props} type="number" min={0} />;
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
    <div className="space-y-3 p-4 border border-slate-100 rounded-lg bg-slate-50/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <button
          type="button"
          onClick={add}
          className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
        >
          + Add Field
        </button>
      </div>
      {entries.length === 0 && (
        <p className="text-xs text-slate-400 italic py-1">No custom fields defined</p>
      )}
      {entries.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries shift on edit
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
            className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded font-medium transition-colors"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────

type TabId = 'general' | 'provider' | 'services' | 'agent' | 'advanced';

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
  const [activeTab, setActiveTab] = useState<TabId>('general');

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

  // MCP Client Update
  function updateMcpClient(m: Partial<typeof draft.mcpClient>) {
    if (!config) return;
    setConfig({ ...config, mcpClient: { ...config.mcpClient, ...m } });
  }

  function updateNotifications(n: Partial<typeof draft.notifications>) {
    if (!config) return;
    setConfig({ ...config, notifications: { ...config.notifications, ...n } });
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <span className="text-sm font-medium text-slate-500">Loading settings…</span>
        </div>
      </div>
    );
  }

  const modelIds = Object.keys(draft.models);

  const tabs: { id: TabId; label: string; description: string }[] = [
    {
      id: 'general',
      label: 'General Settings',
      description: 'Default models, behavior rules, styles',
    },
    {
      id: 'provider',
      label: 'Provider & Models',
      description: 'API Server credentials, model list configurations',
    },
    {
      id: 'services',
      label: 'Web Integration',
      description: 'Google Search & URL text fetch APIs',
    },
    {
      id: 'agent',
      label: 'Agent & Background',
      description: 'Safety boundaries, memory limits, task workers',
    },
    {
      id: 'advanced',
      label: 'Advanced & Hooks',
      description: 'Webhooks, raw TOML bypasses, MCP server timeout',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Top Header */}
      <div className="border-b border-slate-200 bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Kimi Configuration</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Control, validate, and customize your agentic workflow behavior
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 text-xs font-semibold rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-sm"
            >
              {testing && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
              )}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-md shadow-indigo-100"
            >
              {saving && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {saving ? 'Saving…' : 'Save Config'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 mt-8">
        {/* Status Card Banner */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {status && (
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm text-sm bg-white',
                status.ready ? 'border-emerald-100' : 'border-rose-100',
              )}
            >
              <div
                className={cn(
                  'h-2.5 w-2.5 rounded-full shrink-0',
                  status.ready ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500 animate-pulse',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">
                  System Status: {status.ready ? 'Ready to work' : 'Configuration Required'}
                </p>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  Auth Mode:{' '}
                  <span className="font-mono text-slate-600 bg-slate-50 px-1 py-0.5 rounded border border-slate-100">
                    {status.authMode}
                  </span>
                  {status.missing.length > 0 && ` • Missing values: ${status.missing.join(', ')}`}
                </p>
              </div>
            </div>
          )}

          {testResult && (
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm text-sm bg-white',
                testResult.ok ? 'border-emerald-100' : 'border-rose-100',
              )}
            >
              <div
                className={cn(
                  'h-2.5 w-2.5 rounded-full shrink-0',
                  testResult.ok ? 'bg-emerald-500' : 'bg-rose-500',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">
                  Connection Status: {testResult.ok ? 'Connection Successful' : 'Connection Failed'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {testResult.ok
                    ? 'Successfully validated model keys and base gateway API.'
                    : `Error: ${testResult.error}`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Tab Layout Container */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar Tab Selector */}
          <div className="lg:col-span-1 space-y-1 bg-white p-3 rounded-lg border border-slate-200 shadow-sm h-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setTestResult(null);
                }}
                className={cn(
                  'w-full text-left px-3.5 py-3 rounded-md transition-all duration-150 group cursor-pointer border border-transparent',
                  activeTab === tab.id
                    ? 'bg-indigo-50 border-indigo-100/50 text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                <p className="text-sm font-semibold">{tab.label}</p>
                <p
                  className={cn(
                    'text-[10px] mt-0.5 truncate',
                    activeTab === tab.id
                      ? 'text-indigo-500/80'
                      : 'text-slate-400 group-hover:text-slate-500',
                  )}
                >
                  {tab.description}
                </p>
              </button>
            ))}
          </div>

          {/* Form Tabs Content Area */}
          <div className="lg:col-span-3 space-y-6">
            {/* 1. GENERAL SETTINGS */}
            {activeTab === 'general' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <Section title="AI Behavior Defaults">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Checkbox
                      label="Thinking Mode"
                      sublabel="Allow deep reasoning paths before formulating code responses"
                      checked={draft.defaults.thinking}
                      onChange={(e) => updateDefaults({ thinking: e.target.checked })}
                    />
                    <Checkbox
                      label="YOLO Mode"
                      sublabel="Skip confirmation prompts for command executions (Caution!)"
                      checked={draft.defaults.yolo}
                      onChange={(e) => updateDefaults({ yolo: e.target.checked })}
                    />
                    <Checkbox
                      label="Plan Mode"
                      sublabel="Force generation of detailed architectural markdown files before coding"
                      checked={draft.defaults.planMode}
                      onChange={(e) => updateDefaults({ planMode: e.target.checked })}
                    />
                    <Checkbox
                      label="Show Thinking Stream"
                      sublabel="Display deep reasoning streams output logs in the main Web Chat"
                      checked={draft.defaults.showThinkingStream}
                      onChange={(e) => updateDefaults({ showThinkingStream: e.target.checked })}
                    />
                  </div>
                </Section>

                <Section title="UI Options & External Tools">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="default-theme">Theme / Colors</Label>
                      <Select
                        id="default-theme"
                        value={draft.defaults.theme}
                        onChange={(e) =>
                          updateDefaults({ theme: e.target.value as 'dark' | 'light' })
                        }
                      >
                        <option value="dark">Dark Theme</option>
                        <option value="light">Light Theme</option>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="default-editor">Preferred Editor</Label>
                      <Input
                        id="default-editor"
                        placeholder="e.g. code, vim, nano"
                        value={draft.defaults.editor}
                        onChange={(e) => updateDefaults({ editor: e.target.value })}
                      />
                    </div>
                  </div>
                </Section>

                <Section title="Telemetry & Extra Assets">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Checkbox
                      label="Telemetry logs"
                      sublabel="Allow sending performance and debugging data to maintain reliability"
                      checked={draft.defaults.telemetry}
                      onChange={(e) => updateDefaults({ telemetry: e.target.checked })}
                    />
                    <Checkbox
                      label="Skip AFK Prompt Injection"
                      sublabel="Prevent automatic prompt enhancements when user goes idle"
                      checked={draft.defaults.skipAfkPromptInjection}
                      onChange={(e) => updateDefaults({ skipAfkPromptInjection: e.target.checked })}
                    />
                    <div className="md:col-span-2">
                      <Checkbox
                        label="Merge All Available Skills"
                        sublabel="Merge global and workspace local skills during execution cycles"
                        checked={draft.defaults.mergeAllAvailableSkills}
                        onChange={(e) =>
                          updateDefaults({ mergeAllAvailableSkills: e.target.checked })
                        }
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <Label>Extra Skills Directories</Label>
                    <p className="text-[10px] text-slate-400 mb-3">
                      Add absolute filesystem folders to index supplementary skills
                    </p>
                    <div className="space-y-2">
                      {draft.defaults.extraSkillDirs.map((dir, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: admin index stable
                        <div key={i} className="flex gap-2">
                          <Input
                            value={dir}
                            placeholder="/absolute/path/to/custom-skills"
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
                            className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-3 rounded font-medium transition-all"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateDefaults({ extraSkillDirs: [...draft.defaults.extraSkillDirs, ''] })
                      }
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 rounded hover:bg-indigo-50 mt-3 transition-colors"
                    >
                      + Add Directory Path
                    </button>
                  </div>
                </Section>
              </div>
            )}

            {/* 2. PROVIDER & MODELS */}
            {activeTab === 'provider' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <Section title="AI Server Credentials">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="provider-type">API Service Type</Label>
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
                      <Label htmlFor="provider-name">Identifier Name</Label>
                      <Input
                        id="provider-name"
                        value={draft.provider.name}
                        onChange={(e) => updateProvider({ name: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="provider-baseUrl">Endpoint Base URL</Label>
                      <Input
                        id="provider-baseUrl"
                        value={draft.provider.baseUrl}
                        onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="provider-apiKey">API Credentials Key</Label>
                      <div className="flex gap-2">
                        <Input
                          id="provider-apiKey"
                          type={revealKey ? 'text' : 'password'}
                          value={draft.provider.apiKey}
                          onChange={(e) => updateProvider({ apiKey: e.target.value })}
                          placeholder={replaceKey ? 'Enter your custom private token' : '••••••••'}
                          disabled={!replaceKey && draft.provider.apiKey === ''}
                        />
                        <button
                          type="button"
                          onClick={() => setRevealKey((v) => !v)}
                          className="px-3 py-2 text-xs font-semibold rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {revealKey ? 'Hide Key' : 'Reveal'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReplaceKey((v) => !v);
                            if (!replaceKey) setRevealKey(true);
                          }}
                          className="px-3 py-2 text-xs font-semibold rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          {replaceKey ? 'Cancel' : 'Replace'}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 mt-2">
                    <KeyValueEditor
                      label="Environment Overrides"
                      data={draft.provider.env}
                      onChange={(env) => updateProvider({ env })}
                    />
                    <KeyValueEditor
                      label="Custom HTTP Headers"
                      data={draft.provider.customHeaders}
                      onChange={(customHeaders) => updateProvider({ customHeaders })}
                    />
                  </div>
                </Section>

                <Section title="Model Configurations list">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-xs font-semibold text-slate-700 block">
                          Default System Model
                        </span>
                        <span className="text-[10px] text-slate-400">
                          Preferred large language model for standard tasks
                        </span>
                      </div>
                      <Select
                        value={draft.defaults.model}
                        onChange={(e) => updateDefaults({ model: e.target.value })}
                        className="w-auto min-w-[14rem] bg-white border border-slate-200"
                      >
                        <option value="">— Select Model —</option>
                        {modelIds.map((id) => (
                          <option key={id} value={id}>
                            {draft.models[id]?.displayName || id}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="space-y-4">
                      {modelIds.length === 0 ? (
                        <p className="text-xs text-slate-400 italic text-center py-6 border border-dashed border-slate-200 rounded-lg">
                          No models registered. Add a model configuration to get started.
                        </p>
                      ) : (
                        modelIds.map((id) => {
                          const m = draft.models[id];
                          if (!m) return null;
                          return (
                            <div
                              key={id}
                              className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm space-y-3 relative hover:border-slate-300 transition-all"
                            >
                              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded font-mono truncate max-w-[200px]">
                                  {id}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeModel(id)}
                                  className="text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2.5 py-1 rounded transition-colors font-medium cursor-pointer"
                                >
                                  Remove Model
                                </button>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                  <Label>API Provider</Label>
                                  <Input
                                    value={m.provider}
                                    placeholder="e.g. managed:kimi-code"
                                    onChange={(e) => updateModel(id, { provider: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <Label>Model Name Code</Label>
                                  <Input
                                    value={m.model}
                                    placeholder="e.g. kimi-for-coding"
                                    onChange={(e) => updateModel(id, { model: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <Label>Max Context (Tokens)</Label>
                                  <NumberInput
                                    value={m.maxContextSize}
                                    onChange={(e) =>
                                      updateModel(id, { maxContextSize: Number(e.target.value) })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                                <div className="md:col-span-2">
                                  <Label>Capabilities</Label>
                                  <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1 bg-slate-50 p-2.5 rounded border border-slate-100">
                                    {CAPABILITIES.map((cap) => (
                                      <label
                                        key={cap}
                                        className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none"
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
                                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                                        />
                                        {cap}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <Label>Display Name</Label>
                                  <Input
                                    value={m.displayName ?? ''}
                                    placeholder="e.g. Kimi Coding Engine"
                                    onChange={(e) =>
                                      updateModel(id, { displayName: e.target.value })
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={addModel}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-3 py-1.5 rounded hover:bg-indigo-50 border border-indigo-200 border-dashed transition-all w-full text-center mt-2 cursor-pointer"
                    >
                      + Add New Model Row
                    </button>
                  </div>
                </Section>
              </div>
            )}

            {/* 3. INTEGRATION SERVICES */}
            {activeTab === 'services' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <Section title="Supplemental Search API">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-sm font-semibold text-slate-700">
                          Enable Google / Web Search
                        </span>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Let the agent scan the live internet when encountering unknown frameworks
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.services.search !== null}
                        onChange={(e) =>
                          updateServices({
                            search: e.target.checked ? { baseUrl: '', apiKey: '' } : null,
                          } as Partial<typeof draft.services>)
                        }
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                      />
                    </div>
                    {draft.services.search && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-slate-200/60 p-4 rounded-lg bg-white shadow-inner animate-in slide-in-from-top-2 duration-150">
                        <div>
                          <Label>Search Base Endpoint</Label>
                          <Input
                            placeholder="https://api.kimi.com/coding/v1/search"
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
                          <Label>Search Secret Key</Label>
                          <Input
                            type="password"
                            placeholder="Search service secret authentication token"
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
                </Section>

                <Section title="Document Extractor Fetch Service">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-sm font-semibold text-slate-700">
                          Enable Markdown Fetching
                        </span>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Allows downloading and indexing URL documentation content
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.services.fetch !== null}
                        onChange={(e) =>
                          updateServices({
                            fetch: e.target.checked ? { baseUrl: '', apiKey: '' } : null,
                          } as Partial<typeof draft.services>)
                        }
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer"
                      />
                    </div>
                    {draft.services.fetch && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-slate-200/60 p-4 rounded-lg bg-white shadow-inner animate-in slide-in-from-top-2 duration-150">
                        <div>
                          <Label>Fetch Base Endpoint</Label>
                          <Input
                            placeholder="https://api.kimi.com/coding/v1/fetch"
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
                          <Label>Fetch Authorization Key</Label>
                          <Input
                            type="password"
                            placeholder="Fetch service authentication token"
                            value={draft.services.fetch.apiKey}
                            onChange={(e) =>
                              updateServices({
                                fetch: {
                                  ...draft.services.fetch,
                                  apiKey: e.target.value,
                                } as NonNullable<typeof draft.services.fetch>,
                              })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </Section>
              </div>
            )}

            {/* 4. AGENT & BACKGROUND */}
            {activeTab === 'agent' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <Section title="Safety & Step Loop Controls">
                  <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 p-3 rounded-lg">
                    <div>
                      <span className="text-xs font-bold text-indigo-800 block">Reset Limits</span>
                      <span className="text-[10px] text-indigo-500/80">
                        Revert loop boundaries to recommended values
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateLoopControl({ ...DEFAULT_LOOP_CONTROL })}
                      className="text-xs font-semibold bg-white text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 px-3 py-1.5 rounded-md border border-indigo-200 transition-colors cursor-pointer"
                    >
                      Reset Defaults
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                    <div>
                      <Label>Max Steps Per Turn</Label>
                      <NumberInput
                        value={draft.loopControl.maxStepsPerTurn}
                        onChange={(e) =>
                          updateLoopControl({
                            maxStepsPerTurn: Math.max(1, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Max Retries Per Step</Label>
                      <NumberInput
                        value={draft.loopControl.maxRetriesPerStep}
                        onChange={(e) =>
                          updateLoopControl({
                            maxRetriesPerStep: Math.max(0, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Max Ralph Iterations</Label>
                      <NumberInput
                        value={draft.loopControl.maxRalphIterations}
                        onChange={(e) =>
                          updateLoopControl({
                            maxRalphIterations: Math.max(0, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Reserved Context Size</Label>
                      <NumberInput
                        value={draft.loopControl.reservedContextSize}
                        onChange={(e) =>
                          updateLoopControl({
                            reservedContextSize: Math.max(0, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Compaction Trigger Ratio</Label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0.1}
                          max={0.95}
                          step={0.05}
                          value={draft.loopControl.compactionTriggerRatio}
                          onChange={(e) =>
                            updateLoopControl({ compactionTriggerRatio: Number(e.target.value) })
                          }
                          className="flex-1 accent-indigo-600 h-2 bg-slate-200 rounded-lg cursor-pointer"
                        />
                        <span className="text-sm font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {draft.loopControl.compactionTriggerRatio}
                        </span>
                      </div>
                    </div>
                  </div>
                </Section>

                <Section title="Background Process Managers">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label>Max Concurrency Tasks</Label>
                      <NumberInput
                        value={draft.background.maxRunningTasks}
                        onChange={(e) =>
                          updateBackground({ maxRunningTasks: Math.max(1, Number(e.target.value)) })
                        }
                      />
                    </div>
                    <div>
                      <Label>Read Stream Chunk (Bytes)</Label>
                      <NumberInput
                        value={draft.background.readMaxBytes}
                        onChange={(e) =>
                          updateBackground({ readMaxBytes: Math.max(100, Number(e.target.value)) })
                        }
                      />
                    </div>
                    <div>
                      <Label>Agent Timeout Limit (Seconds)</Label>
                      <NumberInput
                        value={draft.background.agentTaskTimeoutS}
                        onChange={(e) =>
                          updateBackground({
                            agentTaskTimeoutS: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Notification Tail Lines</Label>
                      <NumberInput
                        value={draft.background.notificationTailLines}
                        onChange={(e) =>
                          updateBackground({
                            notificationTailLines: Math.max(1, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Notification Tail Chars</Label>
                      <NumberInput
                        value={draft.background.notificationTailChars}
                        onChange={(e) =>
                          updateBackground({
                            notificationTailChars: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Log Poll Interval (ms)</Label>
                      <NumberInput
                        value={draft.background.waitPollIntervalMs}
                        onChange={(e) =>
                          updateBackground({
                            waitPollIntervalMs: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Heartbeat Interval (ms)</Label>
                      <NumberInput
                        value={draft.background.workerHeartbeatIntervalMs}
                        onChange={(e) =>
                          updateBackground({
                            workerHeartbeatIntervalMs: Math.max(100, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Worker Expire Limit (ms)</Label>
                      <NumberInput
                        value={draft.background.workerStaleAfterMs}
                        onChange={(e) =>
                          updateBackground({
                            workerStaleAfterMs: Math.max(500, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Task Graceful Terminate (ms)</Label>
                      <NumberInput
                        value={draft.background.killGracePeriodMs}
                        onChange={(e) =>
                          updateBackground({
                            killGracePeriodMs: Math.max(0, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div className="lg:col-span-3 pt-2">
                      <Checkbox
                        label="Keep Active background Tasks on exit"
                        sublabel="Background sub-agents will continue compiling your workspace even if you close the tab"
                        checked={draft.background.keepAliveOnExit}
                        onChange={(e) => updateBackground({ keepAliveOnExit: e.target.checked })}
                      />
                    </div>
                  </div>
                </Section>
              </div>
            )}

            {/* 5. ADVANCED & HOOKS */}
            {activeTab === 'advanced' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                {status?.system && (
                  <Section title="Server Environment & Limits (Read-only)">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-between">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                          Workspace Directory
                        </span>
                        <span
                          className="text-xs font-mono text-slate-700 mt-1.5 truncate block"
                          title={status.system.workspaceRoot}
                        >
                          {status.system.workspaceRoot}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-between">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                          Max Upload File Limit
                        </span>
                        <span className="text-sm font-semibold text-slate-800 mt-1.5 block">
                          {(status.system.maxUploadBytes / (1024 * 1024)).toFixed(0)} MB{' '}
                          <span className="text-xs text-slate-400 font-normal">
                            ({status.system.maxUploadBytes.toLocaleString()} bytes)
                          </span>
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-between">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                          Server Log Level
                        </span>
                        <span className="text-sm font-semibold text-slate-800 mt-1.5 block uppercase">
                          {status.system.logLevel}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-between">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                          Active Node Port
                        </span>
                        <span className="text-sm font-mono font-bold text-slate-700 mt-1.5 block">
                          :{status.system.port}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex flex-col justify-between">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">
                          Server Environment Mode
                        </span>
                        <span
                          className={cn(
                            'text-xs font-semibold px-2 py-0.5 rounded border mt-1.5 w-fit block',
                            status.system.nodeEnv === 'production'
                              ? 'bg-amber-50 border-amber-100 text-amber-800'
                              : 'bg-blue-50 border-blue-100 text-blue-800',
                          )}
                        >
                          {status.system.nodeEnv}
                        </span>
                      </div>
                    </div>
                  </Section>
                )}

                <Section title="MCP Gateway & Active Alerts">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Stale Alert Limit (ms)</Label>
                      <NumberInput
                        value={draft.notifications.claimStaleAfterMs}
                        onChange={(e) =>
                          updateNotifications({
                            claimStaleAfterMs: Math.max(100, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>MCP Server Tool Timeout (ms)</Label>
                      <NumberInput
                        value={draft.mcpClient.toolCallTimeoutMs}
                        onChange={(e) =>
                          updateMcpClient({
                            toolCallTimeoutMs: Math.max(100, Number(e.target.value)),
                          })
                        }
                      />
                    </div>
                  </div>
                </Section>

                <Section title="Automation Shell Webhooks (Hooks)">
                  <p className="text-[10px] text-slate-400 -mt-2.5 mb-3">
                    Hook shell execution codes trigger at specific engine workflow cycles
                  </p>
                  <div className="space-y-4">
                    {draft.hooks.length === 0 ? (
                      <p className="text-xs text-slate-400 italic text-center py-6 border border-dashed border-slate-200 rounded-lg">
                        No active event hooks defined. Add a webhook handler rule below.
                      </p>
                    ) : (
                      draft.hooks.map((h, i) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: admin index stable
                          key={i}
                          className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end border border-slate-200 rounded-lg p-4 bg-white shadow-sm relative hover:border-slate-300 transition-all"
                        >
                          <div className="md:col-span-3">
                            <Label>Lifecycle Event</Label>
                            <Input
                              placeholder="e.g. before_command"
                              value={h.event}
                              onChange={(e) => updateHook(i, { event: e.target.value })}
                            />
                          </div>
                          <div className="md:col-span-3">
                            <Label>Execute Shell Command</Label>
                            <Input
                              placeholder="e.g. echo 'Triggered'"
                              value={h.command}
                              onChange={(e) => updateHook(i, { command: e.target.value })}
                            />
                          </div>
                          <div className="md:col-span-3">
                            <Label>File Pattern / Matcher</Label>
                            <Input
                              placeholder="e.g. *.go (Optional)"
                              value={h.matcher ?? ''}
                              onChange={(e) =>
                                updateHook(i, { matcher: e.target.value || undefined })
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Label>Timeout (s)</Label>
                            <NumberInput
                              placeholder="Optional"
                              value={h.timeout ?? ''}
                              onChange={(e) =>
                                updateHook(i, {
                                  timeout: e.target.value ? Number(e.target.value) : undefined,
                                })
                              }
                            />
                          </div>
                          <div className="md:col-span-1 text-right">
                            <button
                              type="button"
                              onClick={() => removeHook(i)}
                              className="text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2 py-2 rounded transition-colors font-medium w-full text-center cursor-pointer"
                            >
                              Del
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                    <button
                      type="button"
                      onClick={addHook}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-3 py-1.5 rounded hover:bg-indigo-50 border border-indigo-200 border-dashed transition-all w-full text-center cursor-pointer"
                    >
                      + Register Shell Action Hook
                    </button>
                  </div>
                </Section>

                <Section title="Raw TOML Configuration Overrides">
                  <div>
                    <Label htmlFor="toml-override">Raw TOML Bypass editor</Label>
                    <p className="text-[10px] text-slate-400 mb-2">
                      Write raw TOML attributes to directly override material `.kimi/config.toml`
                      outputs
                    </p>
                    <textarea
                      id="toml-override"
                      value={draft.extraTomlOverride}
                      onChange={(e) =>
                        setConfig((c) => (c ? { ...c, extraTomlOverride: e.target.value } : c))
                      }
                      rows={8}
                      placeholder="# Specify direct overrides here&#10;# [models.my-model]&#10;# key = 'value'"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-all shadow-inner"
                    />
                  </div>
                </Section>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Bottom Notification Alert */}
      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold bg-slate-900 text-white animate-in fade-in slide-in-from-bottom-5 duration-200 z-50 flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping" />
          {toast}
        </div>
      )}
    </div>
  );
}
