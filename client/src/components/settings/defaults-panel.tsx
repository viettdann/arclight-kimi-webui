import { APPROVAL_MODES, type ApprovalMode } from 'shared/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
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
    <Section
      title="Session defaults"
      description="Applied to every new session · Saved automatically"
    >
      <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">Approval mode</p>
          <p className="text-xs text-muted-foreground">
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

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">Thinking mode</p>
          <p className="text-xs text-muted-foreground">
            Allow extended reasoning before answering.
          </p>
        </div>
        <Checkbox checked={thinking} onChange={(e) => setThinking(e.target.checked)} />
      </label>
    </Section>
  );
}
