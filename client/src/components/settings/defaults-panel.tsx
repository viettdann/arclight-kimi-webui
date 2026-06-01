import { APPROVAL_MODES, type ApprovalMode } from 'shared/types';
import { SecHead } from '@/components/ui/sec-head';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSessionDefaultsStore } from '../../lib/session-defaults-store';

const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  ask: 'Ask — confirm every tool call',
  safe: 'Safe — auto-approve read-only tools',
  bypass: 'Bypass — auto-approve everything',
};

export function DefaultsPanel() {
  const approvalMode = useSessionDefaultsStore((s) => s.approvalMode);
  const thinking = useSessionDefaultsStore((s) => s.thinking);
  const setApprovalMode = useSessionDefaultsStore((s) => s.setApprovalMode);
  const setThinking = useSessionDefaultsStore((s) => s.setThinking);

  return (
    <div>
      <SecHead
        title="Session defaults"
        description="Applied to every new session · Saved automatically."
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Approval mode</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              How tool calls are confirmed before they run.
            </p>
          </div>
          <Select
            id="default-approval"
            value={approvalMode}
            onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
            className="w-auto min-w-[16rem]"
          >
            {APPROVAL_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {APPROVAL_LABELS[mode]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
          <div className="min-w-0">
            <p id="default-thinking-label" className="text-sm font-semibold text-foreground">
              Thinking mode
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Allow extended reasoning before answering.
            </p>
          </div>
          <Switch
            checked={thinking}
            onCheckedChange={setThinking}
            aria-labelledby="default-thinking-label"
          />
        </div>
      </div>
    </div>
  );
}
