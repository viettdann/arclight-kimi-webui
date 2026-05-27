import { useEffect, useState } from 'react';
import type { AccessControlResponse, AllowedEmailDTO } from 'shared/types';
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

export function AccessControlTab() {
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
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
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
    <div className="space-y-6 animate-in fade-in duration-200">
      {error && (
        <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Toggle card */}
      <section className="border border-slate-200 rounded-lg p-5 space-y-4 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-indigo-600">
              Access Control
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              When on, only listed emails (and admins) may use the app.
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold border',
              effective
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : 'bg-slate-100 border-slate-200 text-slate-500',
            )}
          >
            {effective ? 'Enforcing' : 'Open'}
          </span>
        </div>
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
                  ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:bg-slate-50',
              )}
            >
              <span
                className={cn(
                  'block text-sm font-semibold',
                  choice === opt.id ? 'text-indigo-700' : 'text-slate-700',
                )}
              >
                {opt.label}
              </span>
              <span className="block text-[10px] text-slate-400 mt-0.5">{opt.sublabel}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Allowlist editor */}
      <section className="border border-slate-200 rounded-lg p-5 space-y-4 bg-white shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-indigo-600">
            Allowed Emails
          </h2>
          <span className="text-xs text-slate-400">{emails.length} listed</span>
        </div>

        {!effective && (
          <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Access control is off — the allowlist is currently inactive.
          </p>
        )}

        <div className="flex gap-2">
          <input
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
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white transition-all placeholder-slate-400"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || newEmail.trim() === ''}
            className="px-4 py-2 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-all whitespace-nowrap cursor-pointer"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>

        {emails.length === 0 ? (
          <p className="text-xs text-slate-400 italic text-center py-6 border border-dashed border-slate-200 rounded-lg">
            No emails listed yet. Add one above.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
            {emails.map((e) => (
              <li
                key={e.email}
                className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors"
              >
                <span className="font-mono text-sm text-slate-700 truncate">{e.email}</span>
                <button
                  type="button"
                  onClick={() => handleRemove(e.email)}
                  className="text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2.5 py-1 rounded font-medium transition-colors cursor-pointer shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
