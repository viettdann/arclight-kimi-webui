import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { Textarea } from '@/components/ui/textarea';
import { useKimiConfigStore } from '../../lib/kimi-config-store';

export function KimiRawTomlPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const status = useKimiConfigStore((s) => s.status);
  const patch = useKimiConfigStore((s) => s.patch);
  if (!config) return null;

  return (
    <div className="space-y-6">
      <Section
        title="Raw TOML override"
        description="Appended verbatim to the generated .kimi/config.toml. Use sparingly."
      >
        <div className="space-y-1.5">
          <Label htmlFor="toml-override">Extra TOML</Label>
          <Textarea
            id="toml-override"
            value={config.extraTomlOverride}
            rows={10}
            spellCheck={false}
            placeholder={'# [models.my-model]\n# key = "value"'}
            onChange={(e) => patch({ extraTomlOverride: e.target.value })}
            className="font-mono"
          />
        </div>
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
