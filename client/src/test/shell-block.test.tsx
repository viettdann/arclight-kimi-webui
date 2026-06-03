import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ShellBlock } from '@/components/display-blocks/shell-block';

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ShellBlock', () => {
  it('renders the command and the language badge', () => {
    render(<ShellBlock command="npm run build" language="bash" />);
    expect(screen.getByText('npm run build')).toBeInTheDocument();
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText('terminal')).toBeInTheDocument();
  });

  it('omits the language badge when language is empty', () => {
    render(<ShellBlock command="ls" language="" />);
    // The header still renders "terminal", but no language chip beside it.
    expect(screen.getByText('terminal')).toBeInTheDocument();
    expect(screen.queryByText('bash')).toBeNull();
  });

  it('copies the command and flips the label, then reverts after the timeout', () => {
    vi.useFakeTimers();
    render(<ShellBlock command="echo hi" language="bash" />);

    expect(screen.getByText('Copy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));

    expect(writeText).toHaveBeenCalledWith('echo hi');
    expect(screen.getByText('Copied')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});
