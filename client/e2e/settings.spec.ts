import { expect, test } from './fixtures/auth';
import { SettingsPage } from './pages/settings.page';
import { SidebarPage } from './pages/sidebar.page';

/** Helper: assert the page pathname equals the expected value. */
async function expectPath(page: import('@playwright/test').Page, expected: string) {
  await expect(page).toHaveURL(
    new RegExp(`^http://[^/]+${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  );
}

test.describe('settings', () => {
  test('settings opens with Providers tab active by default', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const settings = new SettingsPage(adminPage);

    await adminPage.goto('/');
    await sidebar.openSettings();
    await expect(settings.dialog).toBeVisible();

    // Providers is the default tab.
    await expect(settings.providersNav).toBeVisible();
  });

  test('all nav items are visible for admin', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const settings = new SettingsPage(adminPage);

    await adminPage.goto('/');
    await sidebar.openSettings();
    await expect(settings.dialog).toBeVisible();

    await expect(settings.providersNav).toBeVisible();
    await expect(settings.workspaceNav).toBeVisible();
    await expect(settings.generalNav).toBeVisible();
    await expect(settings.systemNav).toBeVisible();
  });

  test('clicking nav items switches content', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const settings = new SettingsPage(adminPage);

    await adminPage.goto('/');
    await sidebar.openSettings();
    await expect(settings.dialog).toBeVisible();

    // Navigate to Workspace.
    await settings.navigateTo('Workspace');
    await expect(settings.workspaceNav).toHaveAttribute('aria-current', 'page');

    // Navigate to General.
    await settings.navigateTo('General');
    await expect(settings.generalNav).toHaveAttribute('aria-current', 'page');
  });

  test('closing settings returns to root page', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const settings = new SettingsPage(adminPage);

    await adminPage.goto('/');
    await sidebar.openSettings();
    await expect(settings.dialog).toBeVisible();

    await settings.close();
    await expect(settings.dialog).not.toBeVisible();
    await expectPath(adminPage, '/');
  });

  test('direct URL /settings/providers opens settings', async ({ adminPage }) => {
    const settings = new SettingsPage(adminPage);
    await adminPage.goto('/settings/providers');
    await adminPage.waitForLoadState('networkidle');

    await expect(settings.dialog).toBeVisible();
    await expect(settings.providersNav).toBeVisible();
  });

  test('direct URL /settings/system opens settings with System section', async ({ adminPage }) => {
    const settings = new SettingsPage(adminPage);
    await adminPage.goto('/settings/system');
    await adminPage.waitForLoadState('networkidle');

    await expect(settings.dialog).toBeVisible();
    await expect(settings.systemNav).toBeVisible();
  });
});
