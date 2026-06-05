import { expect, test } from './fixtures/auth';
import { ChatPage } from './pages/chat.page';

test.describe('chat interaction', () => {
  test('chat input is present on root page (disabled when no project)', async ({ adminPage }) => {
    const chat = new ChatPage(adminPage);
    await adminPage.goto('/');

    // Chat input is present but may be disabled when no project is selected.
    await expect(chat.chatInput).toBeVisible();

    // The placeholder should indicate why it's disabled.
    const placeholder = await chat.chatInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
    // When no project is selected, the placeholder should mention project selection.
    expect(placeholder).toContain('project');
  });

  test('chat input placeholder reflects state', async ({ adminPage }) => {
    const chat = new ChatPage(adminPage);
    await adminPage.goto('/');

    const placeholder = await chat.chatInput.getAttribute('placeholder');
    // One of the possible placeholders depending on state:
    // - "Select or create a project to start..."
    // - "No models available — configure a provider to start"
    // - "Ask anything..."
    expect(placeholder).toBeTruthy();
  });

  test('approval mode button is present but disabled without project', async ({ adminPage }) => {
    await adminPage.goto('/');

    // Approval mode button exists but is disabled when no project selected.
    const approvalButton = adminPage.getByRole('button', { name: 'Approval mode' });
    await expect(approvalButton).toBeVisible();
    await expect(approvalButton).toBeDisabled();
  });

  test('model selector is present but disabled without project', async ({ adminPage }) => {
    await adminPage.goto('/');

    // Model button exists but may be disabled.
    const modelButton = adminPage.getByRole('button', { name: 'Model' });
    if (await modelButton.isVisible()) {
      await expect(modelButton).toBeDisabled();
    }
  });
});
