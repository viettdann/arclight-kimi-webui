import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDeleteSessionDialog } from '@/components/confirm-delete-session-dialog';

afterEach(cleanup);

const base = {
  title: 'My session',
  onConfirm: async () => {},
  onClose: () => {},
};

describe('ConfirmDeleteSessionDialog', () => {
  it('renders nothing meaningful while closed', () => {
    render(<ConfirmDeleteSessionDialog {...base} isOpen={false} />);
    expect(screen.queryByText('Delete session?')).toBeNull();
  });

  it('shows the session title and the destructive copy when open', () => {
    render(<ConfirmDeleteSessionDialog {...base} isOpen />);
    expect(screen.getByText('Delete session?')).toBeInTheDocument();
    expect(screen.getByText('My session')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmDeleteSessionDialog {...base} isOpen onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('confirms then closes on a successful delete', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ConfirmDeleteSessionDialog {...base} isOpen onConfirm={onConfirm} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces the error and stays open when delete rejects', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<ConfirmDeleteSessionDialog {...base} isOpen onConfirm={onConfirm} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
