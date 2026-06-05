import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from '@/components/settings/number-field';

afterEach(cleanup);

describe('NumberField', () => {
  it('renders the label and the current value', () => {
    render(<NumberField label="Max turns" value={7} onChange={() => {}} />);
    expect(screen.getByText('Max turns')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveValue(7);
  });

  it('reports the parsed number on change', () => {
    const onChange = vi.fn();
    render(<NumberField label="N" value={1} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('clamps below the minimum', () => {
    const onChange = vi.fn();
    render(<NumberField label="N" value={5} min={2} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clamps above the maximum', () => {
    const onChange = vi.fn();
    render(<NumberField label="N" value={5} max={10} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('passes a value within range through unchanged', () => {
    const onChange = vi.fn();
    render(<NumberField label="N" value={5} min={1} max={10} onChange={onChange} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });
});
