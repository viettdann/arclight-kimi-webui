import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmBypassDialog } from '@/components/confirm-bypass-dialog';

afterEach(cleanup);

describe('ConfirmBypassDialog', () => {
  it('stays hidden while closed', () => {
    render(<ConfirmBypassDialog isOpen={false} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Bypass permissions?')).toBeNull();
  });

  it('explains the bypass mode when open', () => {
    render(<ConfirmBypassDialog isOpen onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Bypass permissions?')).toBeInTheDocument();
    expect(screen.getByText(/run every tool/i)).toBeInTheDocument();
  });

  it('confirms on the primary action and closes on Cancel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmBypassDialog isOpen onConfirm={onConfirm} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Bypass permissions' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
