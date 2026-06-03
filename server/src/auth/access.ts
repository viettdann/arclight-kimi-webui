import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { accessControl, allowedEmail } from '../db/schema';
import { env } from '../env';

/** Minimal user shape the gate needs — role for admin bypass, email to match. */
export interface AccessUser {
  role?: string;
  email: string;
}

/** Canonical allowlist key — applied identically at every write, read, and compare. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Resolved state of the allowlist gate: the override against the env baseline. */
export interface AccessControlState {
  /** Admin override; `null` means "follow the env default". */
  override: boolean | null;
  /** Effective value of the `ACCESS_CONTROL_ENABLED` env flag. */
  envDefault: boolean;
  /** Resolved gate state: `override ?? envDefault`. */
  effective: boolean;
}

/**
 * Read the `access_control` override (id = 1) and resolve it against the
 * ACCESS_CONTROL_ENABLED env default (`true` when unset). A null or missing
 * row means "follow the env default".
 */
export async function resolveAccessControl(db: DB): Promise<AccessControlState> {
  const [row] = await db
    .select({ enabled: accessControl.enabled })
    .from(accessControl)
    .where(eq(accessControl.id, 1))
    .limit(1);
  const override = row?.enabled ?? null;
  const envDefault = env.ACCESS_CONTROL_ENABLED === 'true';
  return { override, envDefault, effective: override ?? envDefault };
}

/** Whether the allowlist gate is currently active. */
export async function isAccessControlEnabled(db: DB): Promise<boolean> {
  return (await resolveAccessControl(db)).effective;
}

/** Admin always; everyone else only if their (normalized) email is listed. */
export async function isUserAllowed(db: DB, user: AccessUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  const [row] = await db
    .select({ email: allowedEmail.email })
    .from(allowedEmail)
    .where(eq(allowedEmail.email, normalizeEmail(user.email)))
    .limit(1);
  return row != null;
}

/** Final gate: access control off → any session passes; on → defer to allowlist. */
export async function canUserAccess(db: DB, user: AccessUser): Promise<boolean> {
  if (!(await isAccessControlEnabled(db))) return true;
  return isUserAllowed(db, user);
}
