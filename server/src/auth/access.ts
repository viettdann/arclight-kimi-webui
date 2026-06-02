import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { allowedEmail } from '../db/schema';
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
 * Resolve access control state. Delegates to the site-settings service for the
 * persisted override. Falls back to `ACCESS_CONTROL_ENABLED` env when no row
 * exists. Accepts an optional `resolveFromSettings` function to avoid circular
 * imports — the caller injects it from the site-settings service.
 */
let _resolveFromSettings:
  | ((db: DB) => Promise<{ override: boolean | null; envDefault: boolean; effective: boolean }>)
  | null = null;

export function setAccessControlResolver(
  fn: (db: DB) => Promise<{ override: boolean | null; envDefault: boolean; effective: boolean }>,
): void {
  _resolveFromSettings = fn;
}

/**
 * Read the access control state from site_settings (key `access.enabled`).
 * Falls back to `ACCESS_CONTROL_ENABLED` env default when no row exists.
 */
export async function resolveAccessControl(db: DB): Promise<AccessControlState> {
  if (_resolveFromSettings) {
    const { override, envDefault, effective } = await _resolveFromSettings(db);
    return { override, envDefault, effective };
  }
  // Fallback: env-only (before the resolver is wired up during bootstrap).
  const envDefault = env.ACCESS_CONTROL_ENABLED === 'true';
  return { override: null, envDefault, effective: envDefault };
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
