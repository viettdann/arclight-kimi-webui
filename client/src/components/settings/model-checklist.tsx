import { Check } from 'lucide-react';
import type { ProviderModelInput } from 'shared/types/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '../../lib/utils';

export interface ModelChecklistProps {
  availableModels: { id: string; displayName: string | null; contextWindow: number | null }[];
  selectedModels: ProviderModelInput[];
  onToggleSelected: (
    modelId: string,
    displayName: string | null,
    contextWindow: number | null,
  ) => void;
  onToggleDefault: (modelId: string) => void;
  manualModelId: string;
  onManualModelIdChange: (v: string) => void;
  onAddManualModel: () => void;
}

export function ModelChecklist({
  availableModels,
  selectedModels,
  onToggleSelected,
  onToggleDefault,
  manualModelId,
  onManualModelIdChange,
  onAddManualModel,
}: ModelChecklistProps) {
  // Index both lists once for O(1) per-row lookups instead of scanning each.
  const availById = new Map(availableModels.map((m) => [m.id, m]));
  const selById = new Map(selectedModels.map((m) => [m.modelId, m]));
  // Union of available-from-test and already-selected.
  const displayIds = new Set([...availById.keys(), ...selById.keys()]);

  return (
    <div className="space-y-2">
      <Label>Models</Label>
      <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
        {[...displayIds].map((modelId) => {
          const avail = availById.get(modelId);
          const sel = selById.get(modelId);
          const checked = !!sel;
          return (
            <label
              key={modelId}
              className="flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onToggleSelected(
                    modelId,
                    avail?.displayName ?? null,
                    avail?.contextWindow ?? null,
                  )
                }
                className="h-3.5 w-3.5"
              />
              <span className="flex-1 text-sm font-mono">{avail?.displayName ?? modelId}</span>
              {checked && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onToggleDefault(modelId);
                  }}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
                    sel?.isDefault
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                  title="Set as default"
                >
                  {sel?.isDefault && <Check className="h-3 w-3" />}
                  {sel?.isDefault ? 'Default' : 'Set default'}
                </button>
              )}
            </label>
          );
        })}
        {displayIds.size === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No models from test — add manually below.
          </p>
        )}
      </div>
      {/* Manual add row (always shown) */}
      <div className="flex gap-2">
        <Input
          value={manualModelId}
          onChange={(e) => onManualModelIdChange(e.target.value)}
          placeholder="Add model id manually…"
          className="text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAddManualModel();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={onAddManualModel}>
          Add
        </Button>
      </div>
    </div>
  );
}
