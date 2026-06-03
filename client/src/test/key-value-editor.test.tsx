import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyValueEditor } from '@/components/settings/key-value-editor';

afterEach(cleanup);

describe('KeyValueEditor', () => {
  it('shows the empty state when there are no entries', () => {
    render(<KeyValueEditor data={{}} onChange={() => {}} />);
    expect(screen.getByText('No entries')).toBeInTheDocument();
  });

  it('adds a blank entry via the Add button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<KeyValueEditor data={{}} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '+ Add' }));
    expect(onChange).toHaveBeenCalledWith({ '': '' });
  });

  it('renders existing entries as key/value inputs', () => {
    render(<KeyValueEditor data={{ TOKEN: 'abc' }} onChange={() => {}} />);
    expect(screen.getByPlaceholderText('key')).toHaveValue('TOKEN');
    expect(screen.getByPlaceholderText('value')).toHaveValue('abc');
  });

  it('renames a key while keeping the value', () => {
    const onChange = vi.fn();
    render(<KeyValueEditor data={{ TOKEN: 'abc' }} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('key'), { target: { value: 'SECRET' } });
    expect(onChange).toHaveBeenCalledWith({ SECRET: 'abc' });
  });

  it('edits a value while keeping the key', () => {
    const onChange = vi.fn();
    render(<KeyValueEditor data={{ TOKEN: 'abc' }} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'xyz' } });
    expect(onChange).toHaveBeenCalledWith({ TOKEN: 'xyz' });
  });

  it('removes the targeted entry by index', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<KeyValueEditor data={{ A: '1', B: '2' }} onChange={onChange} />);

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(removeButtons[1]!); // remove B
    expect(onChange).toHaveBeenCalledWith({ A: '1' });
  });

  it('renders the label and a top Add button when a label is provided', () => {
    render(<KeyValueEditor label="Headers" data={{}} onChange={() => {}} />);
    expect(screen.getByText('Headers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add' })).toBeInTheDocument();
  });
});
