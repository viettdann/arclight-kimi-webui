import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '@/components/settings/toggle';

afterEach(cleanup);

describe('Toggle', () => {
  it('renders the label and optional description', () => {
    render(<Toggle label="Thinking" description="Show reasoning" checked={false} onChange={() => {}} />);
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    expect(screen.getByText('Show reasoning')).toBeInTheDocument();
  });

  it('reflects the checked prop', () => {
    render(<Toggle label="On" checked onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('emits the next boolean when clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle label="Flip" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('emits false when toggling off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle label="Flip" checked onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
