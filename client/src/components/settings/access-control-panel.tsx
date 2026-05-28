import { useEffect, useState } from 'react';
import type { AccessControlResponse, AllowedEmailDTO } from 'shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/ui/section';
import {
  addAllowedEmail,
  fetchAccessControl,
  listAllowlist,
  removeAllowedEmail,
  setAccessControl,
} from '../../api/access';
import { cn } from '../../lib/utils';

type OverrideChoice = 'default' | 'on' | 'off';

function choiceFromOverride(override: boolean | null): OverrideChoice {
  if (override === null) return 'default';
  return override ? 'on' : 'off';
}

function overrideFromChoice(choice: OverrideChoice): boolean | null {
  if (choice === 'default') return null;
  return choice === 'on';
}

export function AccessControlPanel() {
  const [control, setControl] = useState<AccessControlResponse | null>(null);
  const [emails, setEmails] = useState<AllowedEmailDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingControl, setSavingControl] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ctrl, list] = await Promise.all([fetchAccessControl(), listAllowlist()]);
        if (!cancelled) {
          setControl(ctrl);
          setEmails(list.emails);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load access control');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function changeOverride(choice: OverrideChoice) {
    setSavingControl(true);
    setError(null);
    try {
      const next = await setAccessControl(overrideFromChoice(choice));
      setControl(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSavingControl(false);
    }
  }

  async function handleAdd() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    setError(null);
    try {
      await addAllowedEmail(email);
      const list = await listAllowlist();
      setEmails(list.emails);
      setNewEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add email');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(email: string) {
    setError(null);
    try {
      await removeAllowedEmail(email);
      setEmails((prev) => prev.filter((e) => e.email !== email));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove email');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const choice = control ? choiceFromOverride(control.override) : 'default';
  const effective = control?.effective ?? true;
  const choices: { id: OverrideChoice; label: string; sublabel: string }[] = [
    {
      id: 'default',
      label: 'Default',
      sublabel: `Follow env (${control?.envDefault ? 'on' : 'off'})`,
    },
    { id: 'on', label: 'On', sublabel: 'Enforce allowlist' },
    { id: 'off', label: 'Off', sublabel: 'Everyone signed in' },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Section
        title="Allowlist enforcement"
        description="When on, only listed emails (and admins) may use the app."
        actions={
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-semibold border',
              effective
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                : 'bg-muted border-border text-muted-foreground',
            )}
          >
            {effective ? 'Enforcing' : 'Open'}
          </span>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          {choices.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={savingControl}
              onClick={() => changeOverride(opt.id)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition-all disabled:opacity-50 cursor-pointer',
                choice === opt.id
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border bg-background hover:bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'block text-sm font-semibold',
                  choice === opt.id ? 'text-primary' : 'text-foreground',
                )}
              >
                {opt.label}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">{opt.sublabel}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Allowed emails"
        description="Add and revoke individual addresses."
        actions={
          <span className="text-xs text-muted-foreground">{emails.length} listed</span>
        }
      >
        {!effective && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Access control is off — the allowlist is currently inactive.
          </p>
        )}

        <div className="flex gap-2">
          <Input
            type="email"
            value={newEmail}
            placeholder="name@company.com"
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleAdd}
            disabled={adding || newEmail.trim() === ''}
          >
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </div>

        {emails.length === 0 ? (
          <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
            No emails listed yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
            {emails.map((e) => (
              <li
                key={e.email}
                className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
              >
                <span className="font-mono text-sm truncate">{e.email}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => handleRemove(e.email)}
                  className="text-destructive hover:text-destructive shrink-0"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
