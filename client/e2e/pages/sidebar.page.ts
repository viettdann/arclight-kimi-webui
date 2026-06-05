import type { Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the main Sidebar component.
 */
export class SidebarPage extends BasePage {
  // ─── Buttons ──────────────────────────────────────────────────────────

  /** "Log in" button (visible when unauthenticated). */
  get loginButton(): Locator {
    return this.page.getByRole('button', { name: /^Log in$/i });
  }

  /** "New task" button. */
  get newTaskButton(): Locator {
    return this.page.getByRole('button', { name: /New task/i });
  }

  /** "New project" button (only visible when authenticated). */
  get newProjectButton(): Locator {
    return this.page.getByRole('button', { name: /New project/i });
  }

  /** "Skills" button. */
  get skillsButton(): Locator {
    return this.page.getByRole('button', { name: /Skills/i });
  }

  /** User menu trigger button (shows avatar + name). */
  get userMenuButton(): Locator {
    return this.page.getByRole('button', { name: 'User menu' });
  }

  /** "Settings" dropdown item inside the user menu. */
  get settingsMenuItem(): Locator {
    return this.page.getByRole('menuitem', { name: /Settings/i });
  }

  /** "Log out" dropdown item inside the user menu. */
  get logoutMenuItem(): Locator {
    return this.page.getByRole('menuitem', { name: /Log out/i });
  }

  // ─── Projects ─────────────────────────────────────────────────────────

  /** "Projects" section heading. */
  get projectsHeading(): Locator {
    return this.page.getByText('Projects').first();
  }

  /** Locator for a specific project row by name. */
  projectRow(name: string): Locator {
    return this.leftSidebar.getByText(name).first();
  }

  /** Locator for a specific session row by title. */
  sessionRow(title: string): Locator {
    return this.leftSidebar.getByText(title).first();
  }

  /** "To restore" section heading (foreign projects). */
  get toRestoreHeading(): Locator {
    return this.page.getByText('To restore');
  }

  /** Empty state text when no projects exist. */
  get emptyState(): Locator {
    return this.page.getByText('No projects yet');
  }

  /** Empty state text for unauthenticated users. */
  get loginPrompt(): Locator {
    return this.page.getByText('Log in to create projects and start tasks');
  }

  /** "Retry" button shown on project load error. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: /Retry/i });
  }

  // ─── Actions ──────────────────────────────────────────────────────────

  /** Click the user menu button to open the dropdown. */
  async openUserMenu() {
    await this.userMenuButton.click();
  }

  /** Open Settings via the user menu dropdown. */
  async openSettings() {
    await this.openUserMenu();
    await this.settingsMenuItem.click();
  }

  /** Log out via the user menu dropdown. */
  async logout() {
    await this.openUserMenu();
    await this.logoutMenuItem.click();
  }

  /** Click "New task" button. */
  async clickNewTask() {
    await this.newTaskButton.click();
  }

  /** Click "New project" button. */
  async clickNewProject() {
    await this.newProjectButton.click();
  }
}
