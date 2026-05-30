import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { MODELS, useConfigStore } from '../../lib/config-store';
import { PanelSaveBar } from './panel-save-bar';

/** Config keys owned by this panel — saved/discarded as one cluster. */
const MODELS_KEYS = ['DEFAULT_MODEL'];

export function ModelsPanel() {
  const loadStatus = useConfigStore((s) => s.loadStatus);
  // Subscribe to `drafts` so the Select re-renders when a new model is staged;
  // see ProviderPanel for the rationale.
  const drafts = useConfigStore((s) => s.drafts);
  const settings = useConfigStore((s) => s.settings);
  const setDraft = useConfigStore((s) => s.setDraft);

  if (loadStatus !== 'ready') return null;

  const defaultModel = drafts.DEFAULT_MODEL ?? settings.DEFAULT_MODEL?.value ?? '';

  return (
    <div className="space-y-6">
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

      <PanelSaveBar keys={MODELS_KEYS} />
    </div>
  );
}
