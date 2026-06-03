// Test preload: stub env vars required by `src/env.ts` so importing the
// handler graph doesn't blow up. Tests that exercise DB/SDK paths inject
// their own fakes via `setHandlerDeps`. The DATABASE_URL value here is never
// actually connected to — postgres-js is lazy, and our handler tests use a
// trap proxy that throws if the singleton is touched.

const stubs: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  BETTER_AUTH_SECRET: 'test-secret-min-32-chars-for-validation-only-x',
  BETTER_AUTH_URL: 'http://localhost:3000',
  AZURE_AD_CLIENT_ID: 'test-client',
  AZURE_AD_CLIENT_SECRET: 'test-secret',
  AZURE_AD_TENANT_ID: 'test-tenant',
  WORKSPACE_ROOT: '/tmp/mtc-webui-test',
  // Test-login backdoor enabled in the test env with a fixed token so suites
  // exercising it parse env consistently. Never set in real .env files.
  TEST_LOGIN_ENABLED: 'true',
  TEST_LOGIN_TOKEN: 'test-login-token-fixed',
};

for (const [key, value] of Object.entries(stubs)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

// Force-clear PGSSLROOTCERT so buildSslOption returns the literal 'require'
// without trying to read a non-existent cert file.
process.env.PGSSLROOTCERT = '';
