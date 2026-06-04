import { expect, test } from './fixtures/auth';
import { SettingsPage } from './pages/settings.page';
import { SidebarPage } from './pages/sidebar.page';

test.describe('smoke', () => {
  test('authenticated admin sees the app shell', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);

    // Left sidebar is visible on desktop (md:translate-x-0).
    await expect(sidebar.leftSidebar).toBeVisible();

    // User menu shows the admin name.
    await expect(sidebar.userMenuButton).toContainText('E2E Admin');

    // "New task" button is present.
    await expect(sidebar.newTaskButton).toBeVisible();

    // "New project" button is present (authenticated).
    await expect(sidebar.newProjectButton).toBeVisible();

    // Header shows the brand mark.
    await expect(
      adminPage.locator('header').getByRole('button', { name: 'Go to home' }),
    ).toBeVisible();
  });

  test('unauthenticated user sees login prompt', async ({ page }) => {
    const sidebar = new SidebarPage(page);
    await page.goto('/');

    // Left sidebar is visible.
    await expect(sidebar.leftSidebar).toBeVisible();

    // "Log in" button is present.
    await expect(sidebar.loginButton).toBeVisible();

    // "New project" button is NOT present (requires auth).
    await expect(sidebar.newProjectButton).not.toBeVisible();

    // Projects area shows login prompt text.
    await expect(sidebar.loginPrompt).toBeVisible();
  });

  test('brand mark navigates to home from settings', async ({ adminPage }) => {
    // Navigate to settings first.
    await adminPage.goto('/settings/providers');
    await adminPage.waitForLoadState('networkidle');

    // Close settings, then verify we're on root.
    const settings = new SettingsPage(adminPage);
    await settings.close();
    await expect(adminPage).toHaveURL(/localhost:5173\/$/);
  });
});
