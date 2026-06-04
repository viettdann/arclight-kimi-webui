import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSignOut, mockClearSession } = vi.hoisted(() => ({
  mockSignOut: vi.fn(),
  mockClearSession: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  signOut: mockSignOut,
}));

vi.mock('../lib/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: { email: string } | null }) => unknown) =>
      selector({ user: { email: 'user@example.com' } }),
    {
      getState: () => ({ clearSession: mockClearSession }),
    },
  ),
}));

import { ComingSoon } from '@/components/coming-soon';

beforeEach(() => {
  mockSignOut.mockReset();
  mockClearSession.mockReset();
});
cleanup();

describe('ComingSoon', () => {
  it('renders the "Coming soon" heading', () => {
    render(<ComingSoon />);
    expect(screen.getByRole('heading', { level: 1, name: /coming soon/i })).toBeInTheDocument();
  });

  it('shows the logged-in user email', () => {
    render(<ComingSoon />);
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('shows a "Sign out" button', () => {
    render(<ComingSoon />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('calls signOut and clearSession when the sign out button is clicked', async () => {
    mockSignOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ComingSoon />);

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(mockClearSession).toHaveBeenCalledWith('manual');
  });

  it('disables the button while signing out', async () => {
    let resolveSignOut!: () => void;
    mockSignOut.mockReturnValue(new Promise<void>((r) => (resolveSignOut = r)));

    const user = userEvent.setup();
    render(<ComingSoon />);

    const button = screen.getByRole('button', { name: /sign out/i });
    await user.click(button);

    // While signOut is pending, the button is disabled and shows alt text.
    expect(button).toBeDisabled();
    expect(screen.getByText(/signing out/i)).toBeInTheDocument();

    // Resolve to clean up.
    resolveSignOut();
  });
});
