import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { MODELS, useConfigStore } from '../../lib/config-store';

export function ModelsPanel() {
  const loadStatus = useConfigStore((s) => s.loadStatus);
  const getValue = useConfigStore((s) => s.getValue);
  const setDraft = useConfigStore((s) => s.setDraft);

  if (loadStatus !== 'ready') return null;

  const defaultModel = getValue('DEFAULT_MODEL');

  return (
    <Section title="Models" description="The model used when a session has no override.">
      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Default model</p>
          <p className="text-xs text-muted-foreground">Applied to every new session.</p>
        </div>
        <Select
          value={defaultModel}
          onChange={(e) => setDraft('DEFAULT_MODEL', e.target.value)}
          className="w-auto min-w-[14rem]"
        >
          {!MODELS.some((m) => m.id === defaultModel) && (
            <option value={defaultModel}>{defaultModel || '— Select —'}</option>
          )}
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
    </Section>
  );
}
