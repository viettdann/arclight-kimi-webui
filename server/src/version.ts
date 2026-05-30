// Single source of truth for the running service version. Surfaced via the
// /health endpoint and forwarded to the Claude Agent SDK as `clientInfo.version`.
export const SERVICE_NAME = 'arclight-mtc-webui';
export const SERVICE_VERSION = '0.0.0';
