// Normalize provider API error strings before they reach the client.
//
// The SDK's ultracode mode internally drives `output_config.effort: xhigh`, and
// users can also select `xhigh` or `max` effort explicitly. Providers/models
// that are not capable reject the turn with a 400 like:
//   API Error: 400 The parameter `output_config.effort` specified in the request
//   are not valid: expected `low`, `medium`, `high` or `max`, but got `xhigh`
//   instead.
// Any such 400 mentioning `output_config.effort` together with `xhigh` or `max`
// is an effort rejection. We surface a directive the user can act on instead of
// the raw 400.

const EFFORT_MESSAGE =
  'This model does not support xhigh/max effort. Switch to a model that supports it, pick low/medium/high effort, or turn off Ultracode.';

/** True when the error text is an xhigh/max effort rejection. */
function isEffortError(text: string): boolean {
  return /output_config\.effort/.test(text) && /\b(?:xhigh|max)\b/.test(text);
}

/**
 * Map a raw provider API error string to a normalized, user-actionable message.
 * xhigh/max effort rejections become the directive above; every other string
 * passes through untouched.
 */
export function normalizeApiError(text: string): string {
  return isEffortError(text) ? EFFORT_MESSAGE : text;
}
