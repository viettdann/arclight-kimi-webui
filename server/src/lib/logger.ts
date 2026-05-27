import { pino, stdSerializers } from 'pino';
import type { SessionStateReason } from 'shared/types';
import { env } from '../env';

// Only attach the pino-pretty worker transport in dev. In test mode we want
// plain JSON on stdout (no worker_threads) so that bun's test runner can
// shut down deterministically and so logs don't interleave with TAP output.
const isDev = env.NODE_ENV === 'development';

// Structured fields a postgres.js PostgresError carries from the wire. The
// driver does `Object.assign(this, x)` so all are own properties.
const PG_ERROR_FIELDS = [
  'code',
  'severity',
  'detail',
  'hint',
  'constraint',
  'table',
  'column',
  'schema',
  'dataType',
  'where',
  'routine',
  'position',
] as const;

/**
 * Drizzle wraps the real driver error in `DrizzleQueryError.cause`, and the
 * std serializer only folds a cause's message+stack into the parent — its
 * structured pg fields (code/detail/constraint/…) get dropped. Walk the cause
 * chain, find the error bearing those fields, and surface them under `pg` so
 * the actionable Postgres detail is never swallowed.
 */
export function errSerializer(err: Error): ReturnType<typeof stdSerializers.err> {
  const out = stdSerializers.err(err);
  for (let e: unknown = err, depth = 0; e && depth < 8; depth++) {
    const cand = e as Record<string, unknown>;
    if (typeof cand.code === 'string') {
      const pg: Record<string, unknown> = {};
      for (const k of PG_ERROR_FIELDS) {
        if (cand[k] != null) pg[k] = cand[k];
      }
      // A wrapped cause (depth > 0) also lost its message — keep it explicit.
      if (depth > 0 && typeof cand.message === 'string') pg.message = cand.message;
      (out as Record<string, unknown>).pg = pg;
      break;
    }
    e = cand.cause;
  }
  return out;
}

export const logger = pino({
  level: env.LOG_LEVEL,
  serializers: { err: errSerializer },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;

// ─────────────────────────── Audit log ───────────────────────────

export type AuditAction =
  | 'upload'
  | 'write'
  | 'download'
  | 'session_close'
  | 'session_delete'
  | 'project_create';

export interface AuditEvent {
  userId: string;
  action: AuditAction;
  path: string;
  bytes: number;
  /** For `session_close` / `session_delete`: which path triggered the action. */
  source?: SessionStateReason;
}

const auditLogger = logger.child({ audit: true });

export function auditLog(e: AuditEvent): void {
  auditLogger.info(e);
}
