import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecretField } from '@/components/settings/secret-field';

afterEach(cleanup);

const base = {
  id: 'token',
  label: 'API Token',
  masked: '***abcd',
  placeholder: 'enter token',
};

describe('SecretField — no saved secret', () => {
  it('renders a plain editable input and reports edits', () => {
    const onChange = vi.fn();
    render(<SecretField {...base} isSet={false} value={null} onChange={onChange} />);

    const input = screen.getByLabelText('API Token');
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: 'plaintext' } });
    expect(onChange).toHaveBeenCalledWith('plaintext');
  });
});

describe('SecretField — saved secret (locked)', () => {
  it('shows the masked value behind a read-only field with a Modify button', () => {
    render(<SecretField {...base} isSet value={null} onChange={() => {}} />);

    expect(screen.getByDisplayValue('***abcd')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Modify key' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm new key' })).toBeNull();
  });

  it('unlocks an editable field with a disabled Confirm until text is entered', async () => {
    const user = userEvent.setup();
    render(<SecretField {...base} isSet value={null} onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Modify key' }));
    const confirm = screen.getByRole('button', { name: 'Confirm new key' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('API Token'), 'newsecret');
    expect(confirm).toBeEnabled();
  });

  it('stages the typed value on Confirm', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SecretField {...base} isSet value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Modify key' }));
    await user.type(screen.getByLabelText('API Token'), 'newsecret');
    await user.click(screen.getByRole('button', { name: 'Confirm new key' }));
    expect(onChange).toHaveBeenCalledWith('newsecret');
  });

  it('reverts to the saved secret on Cancel', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SecretField {...base} isSet value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Modify key' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('SecretField — staged replacement', () => {
  it('indicates a staged key and discards it on demand', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SecretField {...base} isSet value="staged-value" onChange={onChange} />);

    expect(screen.getByDisplayValue('•••••••• (new)')).toBeInTheDocument();
    expect(screen.getByText('New key staged — Save to apply.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard staged key' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
