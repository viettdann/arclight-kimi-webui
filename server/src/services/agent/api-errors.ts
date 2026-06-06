// Normalize provider API error strings before they reach the client.
//
// The SDK's ultracode mode internally drives `output_config.effort: xhigh`.
// Providers/models that are not xhigh-capable reject the turn with a 400 like:
//   API Error: 400 The parameter `output_config.effort` specified in the request
//   are not valid: expected `low`, `medium`, `high` or `max`, but got `xhigh`
//   instead.
// Any such 400 mentioning `output_config.effort` together with `xhigh` or `max`
// is by definition an ultracode failure (the provider is not xhigh-capable). The
// app only supports low/medium/high, so we never remap to `max`; we surface a
// directive the user can act on instead of the raw 400.

const ULTRACODE_EFFORT_MESSAGE =
  'Ultracode requires an xhigh-capable model. This provider only supports low/medium/high effort — turn Ultracode off or switch model.';

/** True when the error text is an ultracode xhigh/max effort rejection. */
function isUltracodeEffortError(text: string): boolean {
  return /output_config\.effort/.test(text) && /\b(?:xhigh|max)\b/.test(text);
}

/**
 * Map a raw provider API error string to a normalized, user-actionable message.
 * Ultracode xhigh/max effort rejections become the directive above; every other
 * string passes through untouched.
 */
export function normalizeApiError(text: string): string {
  return isUltracodeEffortError(text) ? ULTRACODE_EFFORT_MESSAGE : text;
}
