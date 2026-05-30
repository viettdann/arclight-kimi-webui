import type { GitCredentialDTO, GitProvider } from 'shared/types/git-credentials';
import type { GitCredentialRow } from '../../db/schema';

/**
 * Mask a git token for display: reveal only the last 4 characters behind a
 * fixed `***` prefix, never the head. Empty/short tokens collapse to `***`
 * (or `***` + whatever ≤4 chars exist).
 */
export function maskApiKey(token: string): string {
  if (!token) return '***';
  return `***${token.slice(-4)}`;
}

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
