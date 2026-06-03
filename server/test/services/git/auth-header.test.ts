import { describe, expect, it } from 'bun:test';
import { buildAuthHeader } from '../../../src/services/git/auth-header';

// Decode the `Authorization: Basic <b64>` header back to its `user:token` form.
function decode(header: string): string {
  const prefix = 'Authorization: Basic ';
  expect(header.startsWith(prefix)).toBe(true);
  const b64 = header.slice(prefix.length);
  return Buffer.from(b64, 'base64').toString();
}

describe('buildAuthHeader', () => {
  it('github with no username defaults to x-access-token', () => {
    const header = buildAuthHeader('github', 'tok-1234');
    expect(header.startsWith('Authorization: Basic ')).toBe(true);
    expect(decode(header)).toBe('x-access-token:tok-1234');
  });

  it('github with username override uses the username', () => {
    const header = buildAuthHeader('github', 'tok-1234', 'octocat');
    expect(header.startsWith('Authorization: Basic ')).toBe(true);
    expect(decode(header)).toBe('octocat:tok-1234');
  });

  it('azure_devops with no username uses an empty user', () => {
    const header = buildAuthHeader('azure_devops', 'tok-1234');
    expect(header.startsWith('Authorization: Basic ')).toBe(true);
    expect(decode(header)).toBe(':tok-1234');
  });

  it('azure_devops with username uses the username', () => {
    const header = buildAuthHeader('azure_devops', 'tok-1234', 'builduser');
    expect(header.startsWith('Authorization: Basic ')).toBe(true);
    expect(decode(header)).toBe('builduser:tok-1234');
  });
});
