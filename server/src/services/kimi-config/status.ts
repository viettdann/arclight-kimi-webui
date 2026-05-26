import type { KimiConfigRow } from 'shared/types/kimi-config';
import { env } from '../../env';

export function computeConfigStatus(row: KimiConfigRow): {
  ready: boolean;
  authMode: 'api_key' | 'unconfigured';
  missing: string[];
  system: {
    workspaceRoot: string;
    maxUploadBytes: number;
    nodeEnv: string;
    logLevel: string;
    port: number;
  };
} {
  const missing: string[] = [];

  if (row.provider.apiKey.length === 0) {
    missing.push('provider.apiKey');
  }

  const defaultModel = row.models[row.defaults.model];
  if (!defaultModel) {
    missing.push('defaults.model');
  }

  const ready = row.provider.apiKey.length > 0 && !!defaultModel;
  const authMode: 'api_key' | 'unconfigured' =
    row.provider.apiKey.length > 0 ? 'api_key' : 'unconfigured';

  return {
    ready,
    authMode,
    missing,
    system: {
      workspaceRoot: env.WORKSPACE_ROOT,
      maxUploadBytes: env.MAX_UPLOAD_BYTES,
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
      port: env.PORT,
    },
  };
}
