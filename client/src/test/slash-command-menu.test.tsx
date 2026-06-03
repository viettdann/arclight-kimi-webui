import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommandInfo } from 'shared/commands';
import { SlashCommandMenu } from '@/components/slash-command-menu';

afterEach(cleanup);

const cmd = (name: string, kind: CommandInfo['kind'], extra: Partial<CommandInfo> = {}): CommandInfo => ({
  name,
  description: '',
  argumentHint: '',
  kind,
  ...extra,
});

const noop = () => {};

describe('SlashCommandMenu', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(
      <SlashCommandMenu items={[]} activeIndex={0} filter="" onSelect={noop} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('splits items into Commands and Skills sections', () => {
    const items = [cmd('compact', 'builtin'), cmd('adopt', 'project'), cmd('review', 'skill')];
    render(<SlashCommandMenu items={items} activeIndex={0} filter="" onSelect={noop} />);

    expect(screen.getByText('Commands')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.getByText('/adopt')).toBeInTheDocument();
    expect(screen.getByText('/review')).toBeInTheDocument();
  });

  it('renders argumentHint, description, and a kind badge', () => {
    const items = [cmd('adopt', 'project', { argumentHint: '[path]', description: 'Adopt a repo' })];
    render(<SlashCommandMenu items={items} activeIndex={0} filter="" onSelect={noop} />);

    expect(screen.getByText('[path]')).toBeInTheDocument();
    expect(screen.getByText('Adopt a repo')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
  });

  it('marks the active row with the accent class', () => {
    const items = [cmd('one', 'builtin'), cmd('two', 'builtin')];
    render(<SlashCommandMenu items={items} activeIndex={1} filter="" onSelect={noop} />);

    const rows = screen.getAllByRole('button');
    expect(rows[0]).not.toHaveClass('bg-accent');
    expect(rows[1]).toHaveClass('bg-accent');
  });

  it('highlights the matched substring of the filter', () => {
    const items = [cmd('compact', 'builtin')];
    render(<SlashCommandMenu items={items} activeIndex={0} filter="com" onSelect={noop} />);

    const match = screen.getByText('com');
    expect(match).toHaveClass('text-primary');
  });

  it('calls onSelect with the clicked command', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items = [cmd('compact', 'builtin')];
    render(<SlashCommandMenu items={items} activeIndex={0} filter="" onSelect={onSelect} />);

    await user.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('calls onHover with the row index on pointer move', async () => {
    const user = userEvent.setup();
    const onHover = vi.fn();
    const items = [cmd('one', 'builtin'), cmd('two', 'builtin')];
    render(
      <SlashCommandMenu items={items} activeIndex={0} filter="" onSelect={noop} onHover={onHover} />,
    );

    const secondRow = screen.getByText('/two');
    await user.hover(secondRow);
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it('omits a badge for builtin commands', () => {
    const items = [cmd('compact', 'builtin')];
    render(<SlashCommandMenu items={items} activeIndex={0} filter="" onSelect={noop} />);
    const row = screen.getByRole('button');
    expect(within(row).queryByText(/^(Project|Skill)$/)).toBeNull();
  });
});
