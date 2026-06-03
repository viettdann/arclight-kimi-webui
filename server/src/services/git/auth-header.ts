import type { GitProvider } from 'shared/types/git-credentials';

// Build a `Authorization: Basic <base64>` header for HTTPS git over PAT.
// github:       base64("<username || 'x-access-token'>:<token>")
// azure_devops: base64("<username || ''>:<token>")  (effective `:<token>`)
export function buildAuthHeader(provider: GitProvider, token: string, username?: string): string {
  const user =
    provider === 'github'
      ? username && username.length > 0
        ? username
        : 'x-access-token'
      : (username ?? '');
  const basic = Buffer.from(`${user}:${token}`).toString('base64');
  return `Authorization: Basic ${basic}`;
}
