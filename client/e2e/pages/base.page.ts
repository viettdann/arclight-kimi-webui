import type { Locator, Page } from '@playwright/test';

/**
 * Base page object with common navigation and wait helpers.
 * All other page objects extend this.
 */
export class BasePage {
  constructor(readonly page: Page) {}

  /** Navigate to a path and wait for the page to stabilize. */
  async goto(path = '/') {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  /** Wait for the Shell layout (left sidebar + header) to be fully rendered. */
  async waitForShell() {
    // The left sidebar has class "border-sidebar-border" to distinguish it
    // from the right sidebar (Todo panel) which has class "border-border".
    await this.leftSidebar.waitFor({ state: 'visible' });
  }

  /** The left sidebar element (navigation, projects). Excludes the right sidebar (Todo). */
  get leftSidebar(): Locator {
    return this.page.locator('aside.border-sidebar-border');
  }

  /** Alias for leftSidebar — the main sidebar. */
  get sidebar(): Locator {
    return this.leftSidebar;
  }

  /** Get the header element. */
  get header(): Locator {
    return this.page.locator('header');
  }
}
