import type { GitCredentialDTO, GitProvider } from 'shared/types/git-credentials';
import type { GitCredentialRow } from '../../db/schema';
import { maskApiKey } from '../kimi-config/mask';

export function toDTO(row: GitCredentialRow): GitCredentialDTO {
  const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: row.id,
    label: row.label,
    provider: row.provider as GitProvider,
    tokenMask: maskApiKey(row.token),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
