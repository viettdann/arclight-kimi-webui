import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/auth-client', () => ({
  getSession: vi.fn(),
}));

vi.mock('../lib/auth-store', () => ({
  useAuthStore: Object.assign(() => null, { getState: () => ({}) }),
}));

import { SubagentAccordion } from './subagent-accordion';

afterEach(cleanup);

describe('SubagentAccordion', () => {
  it('renders the activity count and header labels', () => {
    render(
      <SubagentAccordion
        parentToolCallId="tc-1"
        blocks={[{ kind: 'text', id: 't1', content: 'hello', isStreaming: false, createdAt: '' }]}
        isStreaming={false}
      />,
    );

    expect(screen.getByText('Subagent Session')).toBeInTheDocument();
    expect(screen.getByText('1 activity')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shows subagent type and description in the header', () => {
    render(
      <SubagentAccordion
        parentToolCallId="tc-1"
        blocks={[]}
        isStreaming={false}
        subagentType="Explore"
        description="Find model quality limits"
      />,
    );

    expect(screen.getByText('Subagent Session')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Find model quality limits')).toBeInTheDocument();
  });

  it('shows the streaming header while active', () => {
    render(
      <SubagentAccordion
        parentToolCallId="tc-1"
        blocks={[]}
        isStreaming={true}
        subagentType="Explore"
        description="Working"
      />,
    );

    expect(screen.getByText('Subagent Active...')).toBeInTheDocument();
  });
});
