import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BriefBlock } from '@/components/display-blocks/brief-block';

afterEach(cleanup);

describe('BriefBlock', () => {
  it('renders the supplied text', () => {
    render(<BriefBlock text="Planning the migration" />);
    expect(screen.getByText('Planning the migration')).toBeInTheDocument();
  });

  it('renders an empty string without throwing', () => {
    const { container } = render(<BriefBlock text="" />);
    expect(container.firstChild).not.toBeNull();
  });
});
