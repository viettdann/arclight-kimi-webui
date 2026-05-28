import type { HookEntry } from 'shared/types/kimi-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { useKimiConfigStore } from '../../lib/kimi-config-store';

export function KimiHooksPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const patch = useKimiConfigStore((s) => s.patch);
  const setConfig = useKimiConfigStore((s) => s.setConfig);
  if (!config) return null;

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

  return (
    <div className="space-y-6">
      <Section title="MCP client" description="Tool call timeout for the MCP client.">
        <div className="space-y-1.5 md:w-1/2">
          <Label>Tool call timeout (ms)</Label>
          <Input
            type="number"
            min={100}
            value={config.mcpClient.toolCallTimeoutMs}
            onChange={(e) =>
              patch({ mcpClient: { toolCallTimeoutMs: Math.max(100, Number(e.target.value)) } })
            }
          />
        </div>
      </Section>

      <Section
        title="Lifecycle hooks"
        description="Shell commands triggered on Kimi CLI lifecycle events."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={addHook}>
            + Add hook
          </Button>
        }
      >
        {config.hooks.length === 0 ? (
          <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
            No hooks configured.
          </p>
        ) : (
          <div className="space-y-3">
            {config.hooks.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable admin index
              <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-3 rounded-md border border-border bg-background p-3 items-end">
                <div className="md:col-span-3 space-y-1">
                  <Label>Event</Label>
                  <Input
                    value={h.event}
                    placeholder="before_command"
                    onChange={(e) => updateHook(i, { event: e.target.value })}
                  />
                </div>
                <div className="md:col-span-4 space-y-1">
                  <Label>Command</Label>
                  <Input
                    value={h.command}
                    placeholder="echo 'triggered'"
                    onChange={(e) => updateHook(i, { command: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label>Matcher</Label>
                  <Input
                    value={h.matcher ?? ''}
                    placeholder="*.ts"
                    onChange={(e) => updateHook(i, { matcher: e.target.value || undefined })}
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label>Timeout (s)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={h.timeout ?? ''}
                    onChange={(e) =>
                      updateHook(i, {
                        timeout: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeHook(i)}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
