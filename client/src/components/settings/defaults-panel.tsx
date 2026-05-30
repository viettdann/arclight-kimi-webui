import { APPROVAL_MODES, type ApprovalMode } from 'shared/types';
import { Label } from '@/components/ui/label';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { useSessionDefaultsStore } from '../../lib/session-defaults-store';
import { Toggle } from './toggle';

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
    <div className="space-y-6">
      <Section title="Session defaults" description="Applied to every new session.">
        <div className="space-y-1.5">
          <Label htmlFor="default-approval">Approval mode</Label>
          <Select
            id="default-approval"
            value={approvalMode}
            onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
            className="w-auto min-w-[20rem]"
          >
            {APPROVAL_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {APPROVAL_LABELS[mode]}
              </option>
            ))}
          </Select>
        </div>

        <Toggle
          label="Thinking mode"
          description="Allow extended reasoning before answering."
          checked={thinking}
          onChange={setThinking}
        />
      </Section>
    </div>
  );
}
