import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DiffBlock } from '@/components/display-blocks/diff-block';

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanup);

describe('DiffBlock — modes', () => {
  it('labels a pure addition as a new file', () => {
    render(<DiffBlock path="src/new.ts" oldText="" newText={'line one\nline two'} />);
    expect(screen.getByText('New file')).toBeInTheDocument();
    expect(screen.getByText('new.ts')).toBeInTheDocument();
    expect(screen.getByText('line one')).toBeInTheDocument();
    expect(screen.getByText('line two')).toBeInTheDocument();
  });

  it('labels a pure removal as a deleted file', () => {
    render(<DiffBlock path="src/gone.ts" oldText="dead code" newText="" />);
    expect(screen.getByText('Deleted file')).toBeInTheDocument();
    expect(screen.getByText('gone.ts')).toBeInTheDocument();
    expect(screen.getByText('dead code')).toBeInTheDocument();
  });

  it('labels a changed file as modified and shows both sides of a changed line', () => {
    render(<DiffBlock path="a/b/file.ts" oldText={'keep\nold\ntail'} newText={'keep\nnew\ntail'} />);
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('file.ts')).toBeInTheDocument();
    // Unchanged line appears once; both the removed and added variants render.
    expect(screen.getByText('keep')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
  });

  it('falls back to the raw path when it has no slash', () => {
    render(<DiffBlock path="root.ts" oldText="" newText="x" />);
    // filename === path when there is no directory segment; rendered as the name.
    expect(screen.getByText('root.ts')).toBeInTheDocument();
  });
});

describe('DiffBlock — copy', () => {
  it('copies the new text', () => {
    render(<DiffBlock path="f.ts" oldText="" newText="fresh" />);
    fireEvent.click(screen.getByRole('button', { name: /Copy New/ }));
    expect(writeText).toHaveBeenCalledWith('fresh');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});
