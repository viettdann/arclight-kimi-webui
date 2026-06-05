import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TodoBlock } from '@/components/display-blocks/todo-block';

afterEach(cleanup);

describe('TodoBlock', () => {
  it('renders every item under the checklist heading', () => {
    render(
      <TodoBlock
        items={[
          { title: 'First', status: 'done' },
          { title: 'Second', status: 'in_progress' },
          { title: 'Third', status: 'pending' },
        ]}
      />,
    );
    expect(screen.getByText('Task Checklist')).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('strikes through completed items only', () => {
    render(
      <TodoBlock
        items={[
          { title: 'Done item', status: 'done' },
          { title: 'Open item', status: 'pending' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]!.className).toContain('line-through');
    expect(items[1]!.className).not.toContain('line-through');
  });

  it('renders an empty checklist without items', () => {
    render(<TodoBlock items={[]} />);
    const list = screen.getByRole('list');
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);
  });
});
