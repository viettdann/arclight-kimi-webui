import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/ui/section';
import { useKimiConfigStore } from '../../lib/kimi-config-store';
import { Toggle } from './toggle';

export function KimiDefaultsPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const patch = useKimiConfigStore((s) => s.patch);
  const setConfig = useKimiConfigStore((s) => s.setConfig);
  if (!config) return null;
  const d = config.defaults;

  return (
    <div className="space-y-6">
      <Section
        title="AI behavior"
        description="Default flags applied to every new session."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Toggle
            label="Thinking mode"
            description="Allow chain-of-thought reasoning before answering."
            checked={d.thinking}
            onChange={(v) => patch({ defaults: { thinking: v } })}
          />
          <Toggle
            label="YOLO mode"
            description="Skip confirmation prompts. Use with caution."
            checked={d.yolo}
            onChange={(v) => patch({ defaults: { yolo: v } })}
          />
        </div>
      </Section>

      <Section
        title="Skills"
        description="Where the agent looks for skill definitions."
      >
        <Toggle
          label="Merge all available skills"
          description="Combine global and workspace-local skill registries."
          checked={d.mergeAllAvailableSkills}
          onChange={(v) => patch({ defaults: { mergeAllAvailableSkills: v } })}
        />

        <div className="border-t border-border pt-4 space-y-2">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Extra skill directories
              </p>
              <p className="text-xs text-muted-foreground/80 mt-0.5">
                Absolute paths to additional skill registries.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                setConfig({
                  ...config,
                  defaults: { ...d, extraSkillDirs: [...d.extraSkillDirs, ''] },
                })
              }
            >
              + Add
            </Button>
          </div>
          {d.extraSkillDirs.length === 0 ? (
            <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-3 text-center">
              No extra directories
            </p>
          ) : (
            <div className="space-y-2">
              {d.extraSkillDirs.map((dir, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable admin index
                <div key={i} className="flex gap-2">
                  <Input
                    value={dir}
                    placeholder="/absolute/path/to/skills"
                    onChange={(e) => {
                      const next = [...d.extraSkillDirs];
                      next[i] = e.target.value;
                      setConfig({ ...config, defaults: { ...d, extraSkillDirs: next } });
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = [...d.extraSkillDirs];
                      next.splice(i, 1);
                      setConfig({ ...config, defaults: { ...d, extraSkillDirs: next } });
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

