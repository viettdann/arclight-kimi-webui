import { expect, test } from './fixtures/auth';
import { ProjectModalPage } from './pages/project-modal.page';
import { SidebarPage } from './pages/sidebar.page';

test.describe('project management', () => {
  test('"New project" button opens the modal', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const modal = new ProjectModalPage(adminPage);

    await sidebar.clickNewProject();
    await modal.waitForOpen();

    await expect(modal.dialog).toBeVisible();
    await expect(modal.nameInput).toBeVisible();
  });

  test('creating a blank project adds it to the sidebar', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const modal = new ProjectModalPage(adminPage);

    await sidebar.clickNewProject();
    const projectName = `test-project-${Date.now()}`;
    await modal.createBlankProject(projectName);

    // Wait for the project to appear in the sidebar.
    await expect(sidebar.projectRow(projectName)).toBeVisible({ timeout: 10_000 });
  });

  test('canceling the new project modal closes it', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const modal = new ProjectModalPage(adminPage);

    await sidebar.clickNewProject();
    await modal.waitForOpen();
    await modal.cancel();

    await expect(modal.dialog).not.toBeVisible();
  });

  test('projects section shows empty state when no projects', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    await adminPage.goto('/');

    // If the test user has no projects yet, the empty state should show.
    const hasProjects = await sidebar
      .projectRow(/./)
      .isVisible()
      .catch(() => false);
    if (!hasProjects) {
      await expect(sidebar.emptyState).toBeVisible();
    }
  });

  test('new project modal has Blank and Clone options', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const modal = new ProjectModalPage(adminPage);

    await sidebar.clickNewProject();
    await modal.waitForOpen();

    await expect(modal.blankRadio).toBeVisible();
    await expect(modal.cloneRadio).toBeVisible();

    await modal.cancel();
  });

  test('switching to Clone mode shows URL input', async ({ adminPage }) => {
    const sidebar = new SidebarPage(adminPage);
    const modal = new ProjectModalPage(adminPage);

    await sidebar.clickNewProject();
    await modal.waitForOpen();

    await modal.cloneRadio.click();
    await expect(modal.urlInput).toBeVisible();

    await modal.cancel();
  });
});
