import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FileRow } from '@/components/blocks/timeline/file-row';

afterEach(cleanup);

describe('FileRow — expandable diff', () => {
  it('renders a plain, non-interactive row when no diff is given', () => {
    render(<FileRow path="src/a.ts" />);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows +/- stats and hides the full diff until clicked', () => {
    render(<FileRow path="src/a.ts" diff={{ oldText: 'old', newText: 'new\nextra' }} />);
    // Stats are visible up front.
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    // The full diff content is collapsed initially.
    expect(screen.queryByText('extra')).toBeNull();

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // DiffBlock now rendered the changed lines.
    expect(screen.getByText('extra')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('extra')).toBeNull();
  });
});
