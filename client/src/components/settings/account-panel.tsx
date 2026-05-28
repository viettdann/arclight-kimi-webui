import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { useAuthStore } from '../../lib/auth-store';

export function AccountPanel() {
  const user = useAuthStore((s) => s.user);
  const allowed = useAuthStore((s) => s.allowed);
  const clearSession = useAuthStore((s) => s.clearSession);

  return (
    <div className="space-y-6">
      <Section title="Signed-in account" description="Your identity for this webui session.">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row label="Name" value={user?.name ?? '—'} />
          <Row label="Email" value={user?.email ?? '—'} mono />
          <Row label="Role" value={user?.role ?? '—'} />
          <Row
            label="Allowlist"
            value={allowed === null ? '—' : allowed ? 'allowed' : 'pending'}
          />
        </dl>
      </Section>

      <Section title="Session" description="Sign out of this webui session.">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => clearSession('manual')}
        >
          Sign out
        </Button>
      </Section>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 text-sm ${mono ? 'font-mono' : ''} text-foreground break-all`}>
        {value}
      </dd>
    </div>
  );
}
