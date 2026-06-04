import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-router supplies the route error + navigation. Drive both through a
// mutable holder so each test can set the thrown error shape.
const holder = vi.hoisted(() => ({ error: null as unknown, navigate: vi.fn() }));
vi.mock('react-router', () => ({
  useRouteError: () => holder.error,
  useNavigate: () => holder.navigate,
  // Mirror react-router's guard: a route error response carries a numeric status.
  isRouteErrorResponse: (e: unknown): boolean =>
    typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number',
}));

import { ErrorView } from '@/components/error-view';

beforeEach(() => {
  holder.error = null;
  holder.navigate.mockReset();
});
afterEach(cleanup);

describe('ErrorView — status presentation', () => {
  it('renders the 404 copy for a not-found route response', () => {
    holder.error = { status: 404, statusText: 'Not Found' };
    render(<ErrorView />);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('renders access-denied copy for 401 and 403', () => {
    holder.error = { status: 403, statusText: 'Forbidden' };
    render(<ErrorView />);
    expect(screen.getByText('403')).toBeInTheDocument();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('renders server-error copy for 500', () => {
    holder.error = { status: 500, statusText: 'Internal Server Error' };
    render(<ErrorView />);
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('shows the detail message for a thrown Error', () => {
    holder.error = new Error('boom went the database');
    render(<ErrorView />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('boom went the database')).toBeInTheDocument();
  });
});

describe('ErrorView — navigation', () => {
  it('navigates home and reloads via the action buttons', async () => {
    const user = userEvent.setup();
    holder.error = { status: 404, statusText: 'Not Found' };
    render(<ErrorView />);

    await user.click(screen.getByRole('button', { name: /Back to home/ }));
    expect(holder.navigate).toHaveBeenCalledWith('/');

    await user.click(screen.getByRole('button', { name: /Reload/ }));
    expect(holder.navigate).toHaveBeenCalledWith(0);
  });
});
