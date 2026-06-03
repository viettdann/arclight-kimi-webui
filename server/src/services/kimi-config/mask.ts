import type { KimiConfigDTO, KimiConfigRow } from 'shared/types/kimi-config';

export function maskApiKey(key: string): string {
  if (key.length === 0) return '';
  if (key.length >= 4) return `***${key.slice(-4)}`;
  return '***';
}

export function maskConfigDTO(row: KimiConfigRow): KimiConfigDTO {
  return {
    defaults: row.defaults,
    provider: {
      ...row.provider,
      apiKey: maskApiKey(row.provider.apiKey),
    },
    models: row.models,
    services: row.services,
    loopControl: row.loopControl,
    background: row.background,
    notifications: row.notifications,
    mcpClient: row.mcpClient,
    hooks: row.hooks,
    extraTomlOverride: row.extraTomlOverride,
    updatedAt: row.updatedAt,
  };
}
