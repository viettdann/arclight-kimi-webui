import { Gauge, RefreshCw } from 'lucide-react';
import { useSessionChat } from '../lib/chat-store';

/** Normalize an SDK reset timestamp (epoch seconds or ms) to a Date. */
function resetDate(resetsAt: number): Date {
  return new Date(resetsAt > 1e12 ? resetsAt : resetsAt * 1000);
}

/** Compact label for the SDK quota window identifiers. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d Opus',
  seven_day_sonnet: '7d Sonnet',
  overage: 'overage',
};

/**
 * Transient API-health notices pinned above the composer:
 *  - an in-flight retry (`api_retry`) while the SDK backs off a 429/5xx, and
 *  - the provider quota status (`rate_limit`) once it leaves `allowed`.
 * Both are best-effort signals — sessions on providers that never emit them
 * render nothing here.
 */
export function ApiStatusNotices({ sessionId }: { sessionId: string }) {
  const session = useSessionChat(sessionId);
  const apiRetry = session?.apiRetry ?? null;
  const rateLimit = session?.rateLimit ?? null;

  const showQuota = rateLimit != null && rateLimit.status !== 'allowed';
  if (!apiRetry && !showQuota) return null;

  const quotaRejected = rateLimit?.status === 'rejected';
  const windowLabel = rateLimit?.rateLimitType
    ? (WINDOW_LABELS[rateLimit.rateLimitType] ?? rateLimit.rateLimitType)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-3 md:px-4 space-y-1.5 pb-1.5 select-none">
      {apiRetry && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-wash px-3 py-1.5 text-xs font-medium text-warning animate-in fade-in duration-200">
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>
            API {apiRetry.errorCode}
            {apiRetry.errorStatus != null ? ` (${apiRetry.errorStatus})` : ''} — retrying{' '}
            {apiRetry.attempt}/{apiRetry.maxRetries} in {Math.round(apiRetry.retryDelayMs / 1000)}s
          </span>
        </div>
      )}
      {showQuota && rateLimit && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium animate-in fade-in duration-200 ${
            quotaRejected
              ? 'border-destructive/30 bg-destructive-wash text-destructive'
              : 'border-warning/30 bg-warning-wash text-warning'
          }`}
        >
          <Gauge className="h-3.5 w-3.5 shrink-0" />
          <span>
            {quotaRejected ? 'Usage quota exceeded' : 'Usage quota running low'}
            {windowLabel ? ` (${windowLabel})` : ''}
            {rateLimit.utilization != null ? ` · ${Math.round(rateLimit.utilization)}% used` : ''}
            {rateLimit.resetsAt != null
              ? ` · resets ${resetDate(rateLimit.resetsAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : ''}
          </span>
        </div>
      )}
    </div>
  );
}
