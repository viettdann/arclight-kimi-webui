import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Login modal dialog.
 */
export class LoginPage {
  constructor(readonly page: Page) {}

  /** The login modal dialog. */
  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  /** "Continue with Microsoft" button inside the dialog. */
  get microsoftButton(): Locator {
    return this.page.getByRole('button', { name: /Continue with Microsoft/i });
  }

  /** "Welcome back" title. */
  get title(): Locator {
    return this.page.getByRole('heading', { name: /Welcome back/i });
  }

  /** Open the login modal by clicking the sidebar "Log in" button. */
  async open() {
    await this.page.getByRole('button', { name: /Log in/i }).click();
    await this.dialog.waitFor({ state: 'visible' });
  }

  /** Click the Microsoft sign-in button. */
  async clickMicrosoft() {
    await this.microsoftButton.click();
  }
}
