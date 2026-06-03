import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { Textarea } from '@/components/ui/textarea';
import { fetchConfigToml } from '../../api/kimi-config';
import { useKimiConfigStore } from '../../lib/kimi-config-store';

export function KimiRawTomlPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const patch = useKimiConfigStore((s) => s.patch);

  const [toml, setToml] = useState<{ content: string; exists: boolean; path: string } | null>(null);
  const [loadingToml, setLoadingToml] = useState(false);
  const [tomlError, setTomlError] = useState<string | null>(null);

  async function loadToml() {
    setLoadingToml(true);
    setTomlError(null);
    try {
      setToml(await fetchConfigToml());
    } catch (e) {
      setTomlError(e instanceof Error ? e.message : 'Failed to read config.toml');
    } finally {
      setLoadingToml(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on mount
  useEffect(() => {
    void loadToml();
  }, []);

  if (!config) return null;

  return (
    <div className="space-y-6">
      <Section
        title="Current .kimi/config.toml"
        description={
          toml?.path
            ? `Read from ${toml.path}. Read-only snapshot of what's on disk now.`
            : 'Read-only snapshot of what is on disk now.'
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadToml()}
            disabled={loadingToml}
          >
            {loadingToml ? 'Reading…' : 'Refresh'}
          </Button>
        }
      >
        {tomlError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {tomlError}
          </p>
        ) : toml && !toml.exists ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            File does not exist yet. Save any change (or run sync) to materialise it.
          </p>
        ) : (
          <Textarea
            value={toml?.content ?? ''}
            rows={16}
            spellCheck={false}
            readOnly
            className="font-mono"
          />
        )}
      </Section>

      <Section
        title="Extra TOML"
        description="Appended verbatim to the end of .kimi/config.toml. Cannot override fields already emitted above — redefining an existing key is a TOML parse error."
      >
        <div className="space-y-1.5">
          <Label htmlFor="toml-override">Append at end of file</Label>
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
    </div>
  );
}
