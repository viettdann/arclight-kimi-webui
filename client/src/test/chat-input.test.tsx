import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AvailableProvidersResponse, ProviderDTO } from 'shared/types/providers';
import type { SessionListItem } from 'shared/types';

// react-router params/search are driven through a mutable holder per test.
const holder = vi.hoisted(() => ({ id: undefined as string | undefined, search: '' }));
const { sendWS, showToast } = vi.hoisted(() => ({ sendWS: vi.fn(), showToast: vi.fn() }));
vi.mock('react-router', () => ({
  useParams: () => ({ id: holder.id }),
  useSearchParams: () => [new URLSearchParams(holder.search), vi.fn()],
}));
// Real router.tsx builds a browser router on import; only the constant is needed.
vi.mock('@/lib/router', () => ({ DRAFT_WORKDIR_PARAM: 'workDir' }));
vi.mock('@/lib/ws-send', () => ({ sendWS }));
vi.mock('@/components/toast-provider', () => ({ showToast }));

import { ChatInput } from '@/components/chat-input';
import { useProvidersStore } from '@/lib/providers-store';
import { useSessionsStore } from '@/lib/sessions-store';
import { useChatStore } from '@/lib/chat-store';
import { useCommandStore } from '@/lib/command-store';
import { useDraftStore } from '@/lib/draft-store';

const provider: ProviderDTO = {
  id: 'prov-1',
  scope: 'builtin',
  type: 'oauth',
  visibility: 'public',
  namespace: 'anthropic',
  baseUrl: null,
  tokenMasked: '***1234',
  models: [
    {
      id: 'm-1',
      modelId: 'claude-sonnet-4-6',
      displayName: 'Sonnet 4.6',
      contextWindow: 200_000,
      isDefault: true,
    },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const catalog: AvailableProvidersResponse = { builtin: [provider], personal: [] };
const emptyCatalog: AvailableProvidersResponse = { builtin: [], personal: [] };

const session = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 'sess-1',
  workDir: '/work/demo',
  projectName: 'demo',
  localWorkDir: '/work/demo',
  origin: 'local',
  title: 'My session',
  firstUserText: null,
  model: 'claude-sonnet-4-6',
  providerId: 'prov-1',
  thinking: false,
  totalTokens: 0,
  totalCostUsd: 0,
  createdAt: '2026-01-01T00:00:00Z',
  lastActiveAt: '2026-01-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  holder.id = 'sess-1';
  holder.search = '';
  sendWS.mockReset();
  showToast.mockReset();
  useProvidersStore.setState({ available: catalog, status: 'ready', error: null });
  useSessionsStore.setState({ sessions: [session()] });
  useChatStore.setState({ sessions: {} });
  useCommandStore.setState({ commandsBySession: {} });
  useDraftStore.setState({ drafts: {} });
});
afterEach(cleanup);

describe('ChatInput — sendable session', () => {
  it('shows the ready placeholder and the resolved model label', () => {
    render(<ChatInput />);
    expect(screen.getByLabelText('Chat input')).toHaveAttribute('placeholder', 'Ask anything...');
    expect(screen.getByText('anthropic/Sonnet 4.6')).toBeInTheDocument();
  });

  it('sends the message with the composer flags and clears the draft', async () => {
    const user = userEvent.setup();
    render(<ChatInput />);

    await user.type(screen.getByLabelText('Chat input'), 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(sendWS).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({
        content: 'hello world',
        model: 'claude-sonnet-4-6',
        providerId: 'prov-1',
      }),
      'sess-1',
    );
    // Optimistic pending user block landed in the chat store.
    expect(useChatStore.getState().sessions['sess-1']?.blocks.at(-1)).toMatchObject({
      kind: 'user',
      content: 'hello world',
      status: 'pending',
    });
    // Draft cleared after send.
    expect(useDraftStore.getState().drafts['sess-1'] ?? '').toBe('');
  });
});

describe('ChatInput — blocked sends', () => {
  it('disables sending and prompts when the session has no resolvable model', async () => {
    const user = userEvent.setup();
    useSessionsStore.setState({ sessions: [session({ providerId: null, model: null })] });
    render(<ChatInput />);

    expect(screen.getByLabelText('Chat input')).toHaveAttribute(
      'placeholder',
      'Select a model to start...',
    );
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    await user.type(screen.getByLabelText('Chat input'), 'hi');
    await user.keyboard('{Enter}');
    expect(sendWS).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({
      message: 'Select a model before sending',
      type: 'error',
    });
  });

  it('disables the composer when no providers are configured', () => {
    useProvidersStore.setState({ available: emptyCatalog, status: 'ready' });
    render(<ChatInput />);
    const input = screen.getByLabelText('Chat input');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute(
      'placeholder',
      'No models available — configure a provider to start',
    );
  });

  it('disables the composer when bound to neither a session nor a draft', () => {
    holder.id = undefined;
    holder.search = '';
    render(<ChatInput />);
    const input = screen.getByLabelText('Chat input');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Select or create a project to start...');
  });
});

describe('ChatInput — slash picker', () => {
  it('opens the command picker on a bare slash and closes it on a non-matching filter', async () => {
    const user = userEvent.setup();
    render(<ChatInput />);
    const input = screen.getByLabelText('Chat input');

    // A bare slash lists every builtin (empty filter → names render as one node).
    await user.type(input, '/');
    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.getByText('/init')).toBeInTheDocument();

    // A filter that matches nothing collapses the picker.
    await user.type(input, 'zz');
    expect(screen.queryByText('Commands')).toBeNull();
  });

  it('rewrites the composer to the chosen command on Enter', async () => {
    const user = userEvent.setup();
    render(<ChatInput />);

    const input = screen.getByLabelText('Chat input') as HTMLTextAreaElement;
    await user.type(input, '/compact');
    await user.keyboard('{Enter}');
    expect(input.value).toBe('/compact ');
    expect(sendWS).not.toHaveBeenCalled();
  });
});

describe('ChatInput — bypass confirmation', () => {
  it('prompts before switching to bypass permissions', async () => {
    const user = userEvent.setup();
    holder.id = 'bypass-sess';
    useSessionsStore.setState({ sessions: [session({ id: 'bypass-sess' })] });
    render(<ChatInput />);

    await user.click(screen.getByRole('button', { name: 'Approval mode' }));
    await user.click(await screen.findByText('Bypass · YOLO'));

    expect(screen.getByText('Bypass permissions?')).toBeInTheDocument();
  });
});
