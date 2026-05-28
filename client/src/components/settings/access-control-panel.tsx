import { useEffect, useMemo, useState } from 'react';
import type { AccessControlResponse, AllowedEmailDTO } from 'shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addAllowedEmail,
  fetchAccessControl,
  listAllowlist,
  removeAllowedEmail,
  setAccessControl,
} from '../../api/access';
import { useAuthStore } from '../../lib/auth-store';
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
  const user = useAuthStore((s) => s.user);

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

  const sortedEmails = useMemo(
    () =>
      [...emails].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      ),
    [emails],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const choice = control ? choiceFromOverride(control.override) : 'default';
  const effective = control?.effective ?? true;
  const envDefault = control?.envDefault ?? true;
  const choices: { id: OverrideChoice; label: string }[] = [
    { id: 'default', label: `Default (${envDefault ? 'on' : 'off'})` },
    { id: 'on', label: 'On' },
    { id: 'off', label: 'Off' },
  ];

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <IdentityRow
        name={user?.name ?? '—'}
        email={user?.email ?? '—'}
        role={user?.role ?? 'user'}
      />

      <section className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              Allowlist enforcement
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When enforcing, only listed emails (and admins) may use the app.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{emails.length} listed</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
                effective
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted border-border text-muted-foreground',
              )}
            >
              {effective ? 'Enforcing' : 'Open'}
            </span>
          </div>
        </header>

        <div className="px-5 py-4 space-y-4">
          <div
            role="radiogroup"
            aria-label="Enforcement mode"
            className="inline-flex rounded-md border border-border bg-muted/40 p-0.5"
          >
            {choices.map((opt) => {
              const active = choice === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={savingControl}
                  onClick={() => changeOverride(opt.id)}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

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
              {adding ? 'Adding…' : 'Add email'}
            </Button>
          </div>

          {sortedEmails.length === 0 ? (
            <p className="text-xs italic text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
              No emails listed yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
              {sortedEmails.map((e) => (
                <li
                  key={e.email}
                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/40 transition-colors"
                >
                  <span className="font-mono text-sm truncate min-w-0">{e.email}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <time
                      className="text-[11px] text-muted-foreground tabular-nums"
                      dateTime={e.createdAt}
                      title={e.createdAt}
                    >
                      {formatDate(e.createdAt)}
                    </time>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => handleRemove(e.email)}
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!effective && (
            <p className="text-xs text-muted-foreground">
              Allowlist is currently inactive — everyone signed in has access.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function IdentityRow({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: 'admin' | 'user' | string;
}) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
      <div
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
      >
        {initial}
      </div>
      <div className="flex flex-1 items-center gap-2 min-w-0 text-sm">
        <span className="font-medium text-foreground truncate">{name}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-mono text-xs text-muted-foreground truncate">{email}</span>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
          role === 'admin'
            ? 'bg-primary/10 border-primary/40 text-primary'
            : 'bg-muted border-border text-muted-foreground',
        )}
      >
        {role}
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
