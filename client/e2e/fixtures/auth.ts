import { test as base, expect, type Page } from '@playwright/test';

/** Token that must match TEST_LOGIN_TOKEN in the server's .env. */
const TEST_LOGIN_TOKEN = 'e2e-test-token';

/** Credentials used by the default authenticated fixture. */
const DEFAULT_ADMIN = {
  email: 'e2e-admin@test.example',
  role: 'admin' as const,
  name: 'E2E Admin',
};

const DEFAULT_USER = {
  email: 'e2e-user@test.example',
  role: 'user' as const,
  name: 'E2E User',
};

export interface AuthFixtures {
  /** A page that is already authenticated as an admin user. */
  adminPage: Page;
  /** A page that is authenticated as a regular user (on the allowlist). */
  userPage: Page;
}

/**
 * Log in via the test-login backdoor and inject the resulting session cookie
 * into the browser context. Returns the API response for callers that need
 * the user/session data.
 */
async function testLogin(
  request: import('@playwright/test').APIRequestContext,
  page: Page,
  opts: { email: string; role: 'admin' | 'user'; name: string },
) {
  const res = await request.post('/api/auth/test-login', {
    headers: {
      'Content-Type': 'application/json',
      'x-test-login': TEST_LOGIN_TOKEN,
    },
    data: opts,
  });
  expect(res.ok()).toBeTruthy();

  // Extract the session cookie from Set-Cookie and inject into the browser.
  const setCookie = res.headers()['set-cookie'];
  if (setCookie) {
    const [pair] = setCookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) {
      await page.context().addCookies([
        {
          name: pair.slice(0, eq).trim(),
          value: decodeURIComponent(pair.slice(eq + 1).trim()),
          domain: 'localhost',
          path: '/',
        },
      ]);
    }
  }

  return res;
}

/**
 * Extended Playwright `test` with authenticated fixtures.
 *
 * Usage:
 *   import { test, expect } from './fixtures/auth';
 *   test('as admin', async ({ adminPage }) => { ... });
 */
export const test = base.extend<AuthFixtures>({
  adminPage: async ({ page, request }, use) => {
    await testLogin(request, page, DEFAULT_ADMIN);
    await page.goto('/');
    // Wait for the auth bootstrap to resolve (sidebar renders, not loading).
    await page.getByRole('button', { name: 'User menu' }).waitFor({ timeout: 10_000 });
    await use(page);
  },

  userPage: async ({ page, request }, use) => {
    await testLogin(request, page, DEFAULT_USER);
    await page.goto('/');
    await page.getByRole('button', { name: 'User menu' }).waitFor({ timeout: 10_000 });
    await use(page);
  },
});

export { DEFAULT_ADMIN, DEFAULT_USER, expect, TEST_LOGIN_TOKEN, testLogin };
