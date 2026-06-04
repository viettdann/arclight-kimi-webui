import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmRestoreSessionDialog } from '@/components/confirm-restore-session-dialog';

afterEach(cleanup);

const base = {
  title: 'Foreign session',
  foreignWorkDir: '/remote/work',
  localWorkDir: '/local/work',
  onConfirm: () => {},
  onClose: () => {},
};

describe('ConfirmRestoreSessionDialog', () => {
  it('stays hidden while closed', () => {
    render(<ConfirmRestoreSessionDialog {...base} isOpen={false} />);
    expect(screen.queryByText('Restore session on this machine?')).toBeNull();
  });

  it('shows the title and both work dirs when open', () => {
    render(<ConfirmRestoreSessionDialog {...base} isOpen />);
    expect(screen.getByText('Restore session on this machine?')).toBeInTheDocument();
    expect(screen.getByText('Foreign session')).toBeInTheDocument();
    expect(screen.getByText('/remote/work')).toBeInTheDocument();
    expect(screen.getByText('/local/work')).toBeInTheDocument();
  });

  it('confirms on Restore and closes on Cancel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmRestoreSessionDialog {...base} isOpen onConfirm={onConfirm} onClose={onClose} />,
    );

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
