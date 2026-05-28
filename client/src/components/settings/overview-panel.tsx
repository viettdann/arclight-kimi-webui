import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { OverviewResponse } from 'shared/types';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { fetchOverview } from '../../api/overview';
import { useKimiConfigStore } from '../../lib/kimi-config-store';
import { cn } from '../../lib/utils';

export function OverviewPanel() {
  const status = useKimiConfigStore((s) => s.status);
  const config = useKimiConfigStore((s) => s.config);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOverview();
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <ConfigStatusCard />
      <ProviderSummaryCard />

      <Section
        title="Runtime"
        description="Process metrics from the running server."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      >
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : overview ? (
          <RuntimeGrid overview={overview} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </Section>

      {status?.system && (
        <Section
          title="System info (read-only)"
          description="Process-level constants resolved at server startup."
        >
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <SystemRow label="Workspace root" value={status.system.workspaceRoot} mono />
            <SystemRow
              label="Max upload"
              value={`${(status.system.maxUploadBytes / (1024 * 1024)).toFixed(0)} MB (${status.system.maxUploadBytes.toLocaleString()} bytes)`}
            />
            <SystemRow label="Log level" value={status.system.logLevel} />
            <SystemRow label="Port" value={`:${status.system.port}`} mono />
            <SystemRow label="Node env" value={status.system.nodeEnv} />
          </dl>
        </Section>
      )}
    </div>
  );

  function ConfigStatusCard() {
    if (!status) return null;
    const ready = status.ready;
    return (
      <Section title="Configuration status" description="Auth mode and missing fields.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
              ready
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300',
            )}
          >
            {ready ? 'Ready' : 'Incomplete'}
          </span>
          <span className="text-muted-foreground">
            Auth mode: <code className="font-mono text-foreground">{status.authMode}</code>
          </span>
          {status.missing.length > 0 && (
            <span className="text-muted-foreground">
              Missing:{' '}
              {status.missing.map((m, i) => (
                <span key={m}>
                  <code className="font-mono text-destructive">{m}</code>
                  {i < status.missing.length - 1 ? ', ' : ''}
                </span>
              ))}{' '}
              ·{' '}
              <Link to="/settings/provider" className="underline hover:no-underline">
                Fix in Provider
              </Link>
            </span>
          )}
        </div>
      </Section>
    );
  }

  function ProviderSummaryCard() {
    if (!config) return null;
    const defaultModel = config.models[config.defaults.model];
    return (
      <Section title="Provider" description="Current credentials and default model.">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <SystemRow label="Type" value={config.provider.type} />
          <SystemRow label="Base URL" value={config.provider.baseUrl || '—'} mono />
          <SystemRow label="Default model key" value={config.defaults.model} mono />
          <SystemRow
            label="Model id"
            value={defaultModel?.model ?? '— (model not in models map)'}
            mono
          />
        </dl>
      </Section>
    );
  }
}

function RuntimeGrid({ overview }: { overview: OverviewResponse }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <SystemRow
          label="Started at"
          value={new Date(overview.runtime.startedAt).toLocaleString()}
        />
        <SystemRow label="Uptime" value={formatUptime(overview.runtime.uptimeSec)} />
        <SystemRow label="Node" value={overview.runtime.nodeVersion} mono />
        <SystemRow label="Bun" value={overview.runtime.bunVersion || 'n/a'} mono />
      </dl>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <HealthCard
          label="Database"
          ok={overview.db.ok}
          detail={
            overview.db.ok
              ? overview.db.latencyMs !== null
                ? `${overview.db.latencyMs} ms`
                : 'ok'
              : (overview.db.error ?? 'error')
          }
        />
        <HealthCard
          label="WebSocket clients"
          ok
          detail={`${overview.ws.clients} connected`}
          neutral
        />
        <HealthCard
          label="Active sessions"
          ok
          detail={`${overview.ws.sessions} in memory`}
          neutral
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <HealthCard
          label="Allowlist"
          ok={!overview.access.effective || overview.access.allowlistCount > 0}
          detail={
            overview.access.effective
              ? `Enforcing · ${overview.access.allowlistCount} emails listed`
              : 'Open · all signed-in users have access'
          }
          neutral={!overview.access.effective}
        />
        <HealthCard
          label="Access control source"
          ok
          neutral
          detail={
            overview.access.override === null
              ? `Env default (${overview.access.envDefault ? 'on' : 'off'})`
              : `Override (${overview.access.override ? 'on' : 'off'})`
          }
        />
      </div>
    </div>
  );
}

function HealthCard({
  label,
  ok,
  detail,
  neutral = false,
}: {
  label: string;
  ok: boolean;
  detail: string;
  neutral?: boolean;
}) {
  const tone = neutral
    ? 'border-border bg-muted/30 text-foreground'
    : ok
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
      : 'border-destructive/40 bg-destructive/10 text-destructive';
  return (
    <div className={cn('rounded-md border px-3 py-2', tone)}>
      <div className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-1 text-sm break-all">{detail}</div>
    </div>
  );
}

function SystemRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm ${mono ? 'font-mono' : ''} text-foreground break-all`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
