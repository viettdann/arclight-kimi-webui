import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the "New project" modal dialog.
 */
export class ProjectModalPage {
  constructor(readonly page: Page) {}

  // ─── Dialog ───────────────────────────────────────────────────────────

  /** The "New project" dialog. */
  get dialog(): Locator {
    return this.page.getByRole('dialog', { name: /New project/i });
  }

  /** "Blank" radio option. */
  get blankRadio(): Locator {
    return this.page.getByRole('radio', { name: /Blank/i });
  }

  /** "Clone" radio option. */
  get cloneRadio(): Locator {
    return this.page.getByRole('radio', { name: /Clone/i });
  }

  /** Project name input (for Blank mode). */
  get nameInput(): Locator {
    return this.page.locator('#new-project-name');
  }

  /** Repository URL input (for Clone mode). */
  get urlInput(): Locator {
    return this.page.locator('#clone-url');
  }

  /** Branch input (optional, for Clone mode). */
  get branchInput(): Locator {
    return this.page.locator('#clone-branch');
  }

  /** "Create" button. */
  get createButton(): Locator {
    return this.page.getByRole('button', { name: /^Create$/i });
  }

  /** "Clone" button (in clone mode). */
  get cloneButton(): Locator {
    return this.page.getByRole('button', { name: /^Clone$/i });
  }

  /** "Cancel" button. */
  get cancelButton(): Locator {
    return this.page.getByRole('button', { name: /Cancel/i });
  }

  // ─── Actions ──────────────────────────────────────────────────────────

  /** Wait for the modal to be visible. */
  async waitForOpen() {
    await this.dialog.waitFor({ state: 'visible' });
  }

  /** Create a blank project with the given name. */
  async createBlankProject(name: string) {
    await this.waitForOpen();
    await this.blankRadio.click();
    await this.nameInput.fill(name);
    await this.createButton.click();
  }

  /** Start cloning a repository. */
  async cloneRepo(url: string, opts?: { name?: string; branch?: string }) {
    await this.waitForOpen();
    await this.cloneRadio.click();
    await this.urlInput.fill(url);
    if (opts?.branch) await this.branchInput.fill(opts.branch);
    if (opts?.name) await this.page.locator('#clone-name').fill(opts.name);
    await this.cloneButton.click();
  }

  /** Close the modal. */
  async cancel() {
    await this.cancelButton.click();
  }
}
