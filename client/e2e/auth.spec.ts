import { expect, test } from './fixtures/auth';
import { LoginPage } from './pages/login.page';
import { SidebarPage } from './pages/sidebar.page';

test.describe('auth flow', () => {
  test('unauthenticated user sees login prompt in sidebar', async ({ page }) => {
    await page.goto('/');
    const sidebar = new SidebarPage(page);
    await sidebar.waitForShell();

    // "Log in" button visible.
    await expect(sidebar.loginButton).toBeVisible();

    // "New project" not visible.
    await expect(sidebar.newProjectButton).not.toBeVisible();

    // Prompt text.
    await expect(sidebar.loginPrompt).toBeVisible();
  });

  test('clicking Log in opens the login modal with Microsoft button', async ({ page }) => {
    await page.goto('/');
    const login = new LoginPage(page);
    await login.open();

    await expect(login.title).toBeVisible();
    await expect(login.microsoftButton).toBeVisible();
  });

  test('authenticated admin sees sidebar with user menu and project controls', async ({
    adminPage,
  }) => {
    const sidebar = new SidebarPage(adminPage);

    // User menu shows admin name.
    await expect(sidebar.userMenuButton).toContainText('E2E Admin');
    await expect(sidebar.userMenuButton).toContainText('e2e-admin@test.example');

    // "Admin" badge is visible.
    await expect(adminPage.getByText('Admin').first()).toBeVisible();

    // Project controls visible.
    await expect(sidebar.newTaskButton).toBeVisible();
    await expect(sidebar.newProjectButton).toBeVisible();

    // "Log in" button NOT visible.
    await expect(sidebar.loginButton).not.toBeVisible();
  });

  test('authenticated admin can open user menu and see Settings + Log out', async ({
    adminPage,
  }) => {
    const sidebar = new SidebarPage(adminPage);
    await sidebar.openUserMenu();

    await expect(sidebar.settingsMenuItem).toBeVisible();
    await expect(sidebar.logoutMenuItem).toBeVisible();
  });

  test('logout clears session and redirects to unauthenticated state', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);

    // Verify authenticated.
    await expect(sidebar.userMenuButton).toBeVisible();

    // Log out — this calls clearSession('manual') which sets status to unauthenticated.
    // The Shell then shows a toast and opens the login modal.
    await sidebar.logout();

    // The user menu button should disappear (unauthenticated).
    await expect(sidebar.userMenuButton).not.toBeVisible({ timeout: 10_000 });

    // The login modal should appear automatically (session expired flow).
    // OR the sidebar "Log in" button appears.
    const loginModalVisible = await adminPage
      .getByRole('dialog')
      .isVisible()
      .catch(() => false);
    const loginButtonVisible = await sidebar.loginButton.isVisible().catch(() => false);
    expect(loginModalVisible || loginButtonVisible).toBeTruthy();
  });
});
