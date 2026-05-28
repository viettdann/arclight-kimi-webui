import { Section } from '@/components/ui/section';
import { useKimiConfigStore } from '../../lib/kimi-config-store';
import { NumberField } from './number-field';
import { Toggle } from './toggle';

export function KimiBackgroundPanel() {
  const config = useKimiConfigStore((s) => s.config);
  const patch = useKimiConfigStore((s) => s.patch);
  if (!config) return null;
  const b = config.background;
  const n = config.notifications;

  function setBg<K extends keyof typeof b>(key: K, value: (typeof b)[K]) {
    patch({ background: { [key]: value } as Partial<typeof b> });
  }

  return (
    <div className="space-y-6">
      <Section
        title="Background workers"
        description="Some fields are internal to the webui worker layer — tweak with care."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumberField
            label="Max running tasks"
            value={b.maxRunningTasks}
            min={1}
            onChange={(v) => setBg('maxRunningTasks', v)}
          />
          <NumberField
            label="Read max bytes"
            value={b.readMaxBytes}
            min={100}
            onChange={(v) => setBg('readMaxBytes', v)}
          />
          <NumberField
            label="Agent task timeout (s)"
            value={b.agentTaskTimeoutS}
            min={1}
            onChange={(v) => setBg('agentTaskTimeoutS', v)}
          />
          <NumberField
            label="Notification tail lines"
            value={b.notificationTailLines}
            min={1}
            onChange={(v) => setBg('notificationTailLines', v)}
          />
          <NumberField
            label="Notification tail chars"
            value={b.notificationTailChars}
            min={10}
            onChange={(v) => setBg('notificationTailChars', v)}
          />
          <NumberField
            label="Print wait ceiling (s)"
            value={b.printWaitCeilingS}
            min={1}
            onChange={(v) => setBg('printWaitCeilingS', v)}
          />
          <NumberField
            label="Wait poll interval (ms)"
            value={b.waitPollIntervalMs}
            min={10}
            onChange={(v) => setBg('waitPollIntervalMs', v)}
          />
          <NumberField
            label="Worker heartbeat (ms)"
            value={b.workerHeartbeatIntervalMs}
            min={100}
            onChange={(v) => setBg('workerHeartbeatIntervalMs', v)}
          />
          <NumberField
            label="Worker stale after (ms)"
            value={b.workerStaleAfterMs}
            min={500}
            onChange={(v) => setBg('workerStaleAfterMs', v)}
          />
          <NumberField
            label="Kill grace period (ms)"
            value={b.killGracePeriodMs}
            min={0}
            onChange={(v) => setBg('killGracePeriodMs', v)}
          />
        </div>

        <Toggle
          label="Keep alive on exit"
          description="Allow background subagents to outlive a closed tab."
          checked={b.keepAliveOnExit}
          onChange={(v) => setBg('keepAliveOnExit', v)}
        />
      </Section>

      <Section title="Notifications" description="Stale claim detection.">
        <NumberField
          label="Claim stale after (ms)"
          value={n.claimStaleAfterMs}
          min={100}
          onChange={(v) => patch({ notifications: { claimStaleAfterMs: v } })}
        />
      </Section>
    </div>
  );
}

