import type { Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the Settings modal dialog.
 */
export class SettingsPage extends BasePage {
  // ─── Dialog ───────────────────────────────────────────────────────────

  /** The settings dialog overlay. */
  get dialog(): Locator {
    return this.page.locator('[data-slot="settings-dialog"]');
  }

  /** "Close settings" button (X). */
  get closeButton(): Locator {
    return this.page.getByRole('button', { name: 'Close settings' });
  }

  /** "Settings" heading. */
  get title(): Locator {
    return this.page.getByRole('heading', { name: 'Settings' });
  }

  // ─── Navigation ───────────────────────────────────────────────────────

  /** A nav item by label (Providers, Workspace, General, System). */
  navItem(label: string): Locator {
    return this.page.locator('[data-slot="settings-dialog"]').getByRole('link', { name: label });
  }

  /** "Providers" nav item. */
  get providersNav(): Locator {
    return this.navItem('Providers');
  }

  /** "Workspace" nav item. */
  get workspaceNav(): Locator {
    return this.navItem('Workspace');
  }

  /** "General" nav item. */
  get generalNav(): Locator {
    return this.navItem('General');
  }

  /** "System" nav item (admin only). */
  get systemNav(): Locator {
    return this.navItem('System');
  }

  // ─── Sections ─────────────────────────────────────────────────────────

  /** "Add provider" button in the Providers section. */
  get addProviderButton(): Locator {
    return this.page.getByRole('button', { name: /Add provider/i });
  }

  // ─── Discard Dialog ───────────────────────────────────────────────────

  /** "Discard unsaved changes?" dialog. */
  get discardDialog(): Locator {
    return this.page.getByRole('dialog', { name: /Discard unsaved changes/i });
  }

  /** "Discard" button in the confirmation dialog. */
  get discardButton(): Locator {
    return this.page.getByRole('button', { name: 'Discard' });
  }

  /** "Keep editing" button in the confirmation dialog. */
  get keepEditingButton(): Locator {
    return this.page.getByRole('button', { name: 'Keep editing' });
  }

  // ─── Actions ──────────────────────────────────────────────────────────

  /** Navigate to a settings section via the sidebar nav. */
  async navigateTo(section: 'Providers' | 'Workspace' | 'General' | 'System') {
    await this.navItem(section).click();
  }

  /** Close the settings dialog. */
  async close() {
    await this.closeButton.click();
  }

  /** Open settings and wait for the dialog to render. */
  async open(sidebarPage: { openSettings: () => Promise<void> }) {
    await sidebarPage.openSettings();
    await this.dialog.waitFor({ state: 'visible' });
  }
}
