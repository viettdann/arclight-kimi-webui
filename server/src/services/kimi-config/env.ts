import type { KimiConfigRow } from 'shared/types/kimi-config';

export function buildEnvFromRow(row: KimiConfigRow): Record<string, string> {
  const env: Record<string, string> = {};
  const p = row.provider;
  const defaultModel = row.models[row.defaults.model];

  if (p.type === 'kimi') {
    env.KIMI_API_KEY = p.apiKey;
    env.KIMI_BASE_URL = p.baseUrl;
    if (defaultModel) {
      env.KIMI_MODEL_NAME = defaultModel.model;
      env.KIMI_MODEL_MAX_CONTEXT_SIZE = String(defaultModel.maxContextSize);
      env.KIMI_MODEL_CAPABILITIES = defaultModel.capabilities.join(',');
      if (defaultModel.temperature !== undefined) {
        env.KIMI_MODEL_TEMPERATURE = String(defaultModel.temperature);
      }
      if (defaultModel.topP !== undefined) {
        env.KIMI_MODEL_TOP_P = String(defaultModel.topP);
      }
      if (defaultModel.maxTokens !== undefined) {
        env.KIMI_MODEL_MAX_TOKENS = String(defaultModel.maxTokens);
      }
    }
  } else if (p.type === 'openai_legacy' || p.type === 'openai_responses') {
    env.OPENAI_API_KEY = p.apiKey;
    env.OPENAI_BASE_URL = p.baseUrl;
  }
  // anthropic: no secret env vars — config file is the only source.

  env.KIMI_CLI_NO_AUTO_UPDATE = '1';

  // Provider-specific overrides (last write wins)
  for (const [k, v] of Object.entries(p.env)) {
    env[k] = v;
  }

  return env;
}
