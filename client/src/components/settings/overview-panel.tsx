import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { OverviewResponse } from 'shared/types';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { fetchOverview } from '../../api/overview';
import { useProvidersStore } from '../../lib/providers-store';
import { cn } from '../../lib/utils';

export function OverviewPanel() {
  const { available, ensureLoaded } = useProvidersStore();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    ensureLoaded();
  }, []);

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

  // Derive provider summary from available catalog.
  const builtinProviders = available?.builtin ?? [];
  const personalProviders = available?.personal ?? [];
  const builtinPublicCount = builtinProviders.filter((p) => p.visibility === 'public').length;
  const totalModels =
    builtinProviders.reduce((acc, p) => acc + p.models.length, 0) +
    personalProviders.reduce((acc, p) => acc + p.models.length, 0);

  return (
    <div className="space-y-6">
      <Section
        title="Providers"
        description="Summary of available providers and models."
        actions={
          <Link
            to="/settings/claude/provider"
            className="text-xs underline hover:no-underline text-muted-foreground"
          >
            Edit in Provider
          </Link>
        }
      >
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <SystemRow
            label="Built-in providers"
            value={`${builtinProviders.length} (${builtinPublicCount} public)`}
          />
          <SystemRow label="Personal providers" value={String(personalProviders.length)} />
          <SystemRow label="Total models" value={String(totalModels)} />
        </dl>
      </Section>

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
    </div>
  );
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
