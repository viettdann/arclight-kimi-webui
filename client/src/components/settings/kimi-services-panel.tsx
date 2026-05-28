import type { ServiceEntry, ServicesBlock } from 'shared/types/kimi-config';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { useKimiConfigStore } from '../../lib/kimi-config-store';

export function KimiServicesPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const setConfig = useKimiConfigStore((s) => s.setConfig);
  if (!config) return null;

  function updateService<K extends keyof ServicesBlock>(key: K, value: ServicesBlock[K]) {
    if (!config) return;
    setConfig({ ...config, services: { ...config.services, [key]: value } });
  }

  return (
    <div className="space-y-6">
      <ServiceSection
        title="Search"
        description="Web search service the agent can query mid-turn."
        value={config.services.search}
        onChange={(v) => updateService('search', v)}
      />
      <ServiceSection
        title="Fetch"
        description="URL/document fetch service for inline content retrieval."
        value={config.services.fetch}
        onChange={(v) => updateService('fetch', v)}
      />
    </div>
  );
}

function ServiceSection({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: ServiceEntry | null;
  onChange: (v: ServiceEntry | null) => void;
}) {
  const enabled = value !== null;
  return (
    <Section title={title} description={description}>
      <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 cursor-pointer">
        <span className="text-sm font-medium">Enabled</span>
        <Checkbox
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { baseUrl: '', apiKey: '' } : null)}
        />
      </label>

      {enabled && value && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={value.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input
              type="password"
              value={value.apiKey}
              onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
            />
          </div>
        </div>
      )}
    </Section>
  );
}
