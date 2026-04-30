import { pino } from 'pino';
import { env } from '../env';

// Only attach the pino-pretty worker transport in dev. In test mode we want
// plain JSON on stdout (no worker_threads) so that bun's test runner can
// shut down deterministically and so logs don't interleave with TAP output.
const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
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

export type AuditAction = 'upload' | 'download';

export interface AuditEvent {
  userId: string;
  action: AuditAction;
  path: string;
  bytes: number;
}

const auditLogger = logger.child({ audit: true });

export function auditLog(e: AuditEvent): void {
  auditLogger.info(e);
}
