import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { useKimiConfigStore } from '../../lib/kimi-config-store';
import { NumberField } from './number-field';

export function KimiAgentPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const patch = useKimiConfigStore((s) => s.patch);
  if (!config) return null;
  const lc = config.loopControl;

  function setLc<K extends keyof typeof lc>(key: K, value: number) {
    patch({ loopControl: { [key]: value } as Partial<typeof lc> });
  }

  return (
    <Section
      title="Agent loop controls"
      description="Safety limits applied to every agent turn."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <NumberField
          label="Max steps per turn"
          value={lc.maxStepsPerTurn}
          min={1}
          onChange={(v) => setLc('maxStepsPerTurn', v)}
        />
        <NumberField
          label="Max retries per step"
          value={lc.maxRetriesPerStep}
          min={0}
          onChange={(v) => setLc('maxRetriesPerStep', v)}
        />
        <NumberField
          label="Max Ralph iterations"
          value={lc.maxRalphIterations}
          min={0}
          onChange={(v) => setLc('maxRalphIterations', v)}
        />
        <NumberField
          label="Reserved context size (tokens)"
          value={lc.reservedContextSize}
          min={0}
          onChange={(v) => setLc('reservedContextSize', v)}
        />
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="compact-ratio">Compaction trigger ratio</Label>
          <div className="flex items-center gap-3">
            <input
              id="compact-ratio"
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={lc.compactionTriggerRatio}
              onChange={(e) => setLc('compactionTriggerRatio', Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded border border-border min-w-[3.5rem] text-center">
              {lc.compactionTriggerRatio.toFixed(2)}
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            Compact the conversation when context usage exceeds this fraction.
          </p>
        </div>
      </div>
    </Section>
  );
}

