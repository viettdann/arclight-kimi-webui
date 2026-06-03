import type { Logger } from '../lib/logger';

// Transient DB error classification. postgres.js wraps the real cause inside
// DrizzleQueryError.cause (sometimes nested), so we walk the cause chain to
// find a recognizable code. Transient = connection-level blip (sleep/wake,
// failover, restart) that recovers on the next pooled connection. Everything
// else (bad query, constraint, auth) is a real bug worth a full error log.

/** postgres.js connection-driver codes + Node socket errnos. */
const TRANSIENT_DRIVER_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
  'CONNECTION_CONNECT_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Postgres server SQLSTATE codes for connectivity / shutdown / overload. */
const TRANSIENT_SQLSTATE = new Set([
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (server still starting)
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
]);

function isTransientCode(code: string): boolean {
  return TRANSIENT_DRIVER_CODES.has(code) || TRANSIENT_SQLSTATE.has(code);
}

/** Walk the `cause` chain (capped) and return the first `code` string found. */
export function dbErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 8; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True when the error is a recoverable connection-level blip, not a real fault. */
export function isTransientDbError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 8; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && isTransientCode(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Log a DB error at the right severity: a concise `warn` (code only, no stack)
 * for transient connection blips, a full `error` (with `err`) otherwise.
 * `msg` is the operation label; suffix is appended automatically.
 */
export function logDbError(
  log: Logger,
  err: unknown,
  bindings: Record<string, unknown>,
  msg: string,
): void {
  if (isTransientDbError(err)) {
    log.warn({ ...bindings, code: dbErrorCode(err) }, `${msg}: db connection lost (transient)`);
  } else {
    log.error({ ...bindings, err }, `${msg}: db error`);
  }
}
