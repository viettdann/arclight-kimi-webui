import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderModelInput } from 'shared/types/providers';
import { ModelChecklist } from '@/components/settings/model-checklist';

afterEach(cleanup);

type Avail = { id: string; displayName: string | null; contextWindow: number | null };

const baseProps = {
  availableModels: [] as Avail[],
  selectedModels: [] as ProviderModelInput[],
  onToggleSelected: () => {},
  onToggleDefault: () => {},
  manualModelId: '',
  onManualModelIdChange: () => {},
  onAddManualModel: () => {},
};

describe('ModelChecklist', () => {
  it('shows the empty hint when there are no models', () => {
    render(<ModelChecklist {...baseProps} />);
    expect(screen.getByText('— none yet, add below')).toBeInTheDocument();
    // Manual add row is always present.
    expect(screen.getByPlaceholderText('Add model id manually…')).toBeInTheDocument();
  });

  it('renders the union of available and already-selected models', () => {
    render(
      <ModelChecklist
        {...baseProps}
        availableModels={[{ id: 'm1', displayName: 'Model One', contextWindow: 1000 }]}
        selectedModels={[{ modelId: 'm2' }]}
      />,
    );
    expect(screen.getByText('Model One')).toBeInTheDocument();
    // A selected-only model with no available metadata falls back to its id.
    expect(screen.getByText('m2')).toBeInTheDocument();
  });

  it('reflects selection state in the checkboxes', () => {
    render(
      <ModelChecklist
        {...baseProps}
        availableModels={[{ id: 'm1', displayName: 'Model One', contextWindow: 1000 }]}
        selectedModels={[{ modelId: 'm2' }]}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0]!.checked).toBe(false); // m1 available, not selected
    expect(checkboxes[1]!.checked).toBe(true); // m2 selected
  });

  it('passes model metadata when toggling selection', async () => {
    const user = userEvent.setup();
    const onToggleSelected = vi.fn();
    render(
      <ModelChecklist
        {...baseProps}
        availableModels={[{ id: 'm1', displayName: 'Model One', contextWindow: 1000 }]}
        onToggleSelected={onToggleSelected}
      />,
    );
    await user.click(screen.getByRole('checkbox'));
    expect(onToggleSelected).toHaveBeenCalledWith('m1', 'Model One', 1000);
  });

  it('exposes a "Set default" action only for selected rows', async () => {
    const user = userEvent.setup();
    const onToggleDefault = vi.fn();
    render(
      <ModelChecklist
        {...baseProps}
        availableModels={[{ id: 'm1', displayName: 'Model One', contextWindow: 1000 }]}
        selectedModels={[{ modelId: 'm1', isDefault: false }]}
        onToggleDefault={onToggleDefault}
      />,
    );
    await user.click(screen.getByText('Set default'));
    expect(onToggleDefault).toHaveBeenCalledWith('m1');
  });

  it('labels the current default row', () => {
    render(
      <ModelChecklist
        {...baseProps}
        availableModels={[{ id: 'm1', displayName: 'Model One', contextWindow: 1000 }]}
        selectedModels={[{ modelId: 'm1', isDefault: true }]}
      />,
    );
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('drives the manual-add row via change, Enter, and the Add button', async () => {
    const user = userEvent.setup();
    const onManualModelIdChange = vi.fn();
    const onAddManualModel = vi.fn();
    render(
      <ModelChecklist
        {...baseProps}
        onManualModelIdChange={onManualModelIdChange}
        onAddManualModel={onAddManualModel}
      />,
    );
    const input = screen.getByPlaceholderText('Add model id manually…');

    fireEvent.change(input, { target: { value: 'custom-model' } });
    expect(onManualModelIdChange).toHaveBeenCalledWith('custom-model');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAddManualModel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAddManualModel).toHaveBeenCalledTimes(2);
  });
});
