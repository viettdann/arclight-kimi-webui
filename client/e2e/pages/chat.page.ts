import type { Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the Chat view and its input area.
 */
export class ChatPage extends BasePage {
  // ─── Input Area ───────────────────────────────────────────────────────

  /** The main chat textarea. */
  get chatInput(): Locator {
    return this.page.getByRole('textbox', { name: 'Chat input' });
  }

  /** "Send message" button. */
  get sendButton(): Locator {
    return this.page.getByRole('button', { name: 'Send message' });
  }

  /** "Stop turn" button (visible while agent is running). */
  get stopButton(): Locator {
    return this.page.getByRole('button', { name: 'Stop turn' });
  }

  /** Approval mode toggle button. */
  get approvalModeButton(): Locator {
    return this.page.getByRole('button', { name: 'Approval mode' });
  }

  /** Model selector button. */
  get modelButton(): Locator {
    return this.page.getByRole('button', { name: 'Model' });
  }

  /** "Select Project" button. */
  get selectProjectButton(): Locator {
    return this.page.getByRole('button', { name: /Select Project/i });
  }

  // ─── Transcript ───────────────────────────────────────────────────────

  /** The transcript scroll container. */
  get transcript(): Locator {
    return this.page.locator('[data-slot="transcript"]');
  }

  // ─── Slash Commands ───────────────────────────────────────────────────

  /** The slash command menu popover. */
  get slashCommandMenu(): Locator {
    return this.page.getByRole('listbox');
  }

  /** A specific slash command option by name. */
  slashCommand(name: string): Locator {
    return this.page.getByRole('option', { name });
  }

  // ─── Welcome Screen ───────────────────────────────────────────────────

  /** The welcome screen heading. */
  get welcomeHeading(): Locator {
    return this.page.getByRole('heading', { name: 'More Than Code' });
  }

  /** Feature card by title. */
  featureCard(title: string): Locator {
    return this.page.locator('aside, main').getByText(title).first();
  }

  // ─── Actions ──────────────────────────────────────────────────────────

  /** Type a message in the chat input. */
  async typeMessage(text: string) {
    await this.chatInput.fill(text);
  }

  /** Type and send a message. */
  async sendMessage(text: string) {
    await this.chatInput.fill(text);
    await this.sendButton.click();
  }

  /** Open the slash command menu by typing "/". */
  async openSlashCommands() {
    await this.chatInput.focus();
    await this.chatInput.fill('/');
    await this.slashCommandMenu.waitFor({ state: 'visible' });
  }

  /** Select a slash command by name. */
  async selectSlashCommand(name: string) {
    await this.openSlashCommands();
    await this.slashCommand(name).click();
  }
}
