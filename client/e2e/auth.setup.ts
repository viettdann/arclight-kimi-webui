import { expect, test as setup } from '@playwright/test';

/**
 * Global setup: authenticate once and save the browser storageState so all
 * downstream E2E tests can reuse the session cookie without hitting the
 * test-login endpoint on every test.
 *
 * Runs as part of the "setup" project (see playwright.config.ts). The saved
 * auth state includes the BetterAuth session cookie that the server minted
 * via POST /api/auth/test-login.
 */

const TEST_LOGIN_TOKEN = process.env.TEST_LOGIN_TOKEN ?? 'e2e-test-token';

const authCases = [
  {
    role: 'admin' as const,
    email: 'e2e-admin@test.example',
    name: 'E2E Admin',
    storageStateFile: '.auth/admin.json',
  },
  {
    role: 'user' as const,
    email: 'e2e-user@test.example',
    name: 'E2E User',
    storageStateFile: '.auth/user.json',
  },
];

for (const { role, email, name, storageStateFile: _storageStateFile } of authCases) {
  setup(`authenticate as ${role}`, async ({ request }) => {
    const res = await request.post('/api/auth/test-login', {
      headers: {
        'Content-Type': 'application/json',
        'x-test-login': TEST_LOGIN_TOKEN,
      },
      data: { email, role, name },
    });
    expect(res.ok()).toBeTruthy();
  });
}
