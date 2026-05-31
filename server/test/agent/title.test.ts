import { describe, expect, it, mock } from 'bun:test';

// The title generator's only external boundary is the Agent SDK `query`. Mock
// it: capture the options passed (so we can assert the `model` threads through)
// and replay a single successful `result` message carrying the title text.
interface CapturedCall {
  model?: unknown;
  prompt?: unknown;
}
const calls: CapturedCall[] = [];

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: string; options: { model?: string } }) => {
    calls.push({ model: options?.model, prompt });
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'Fix login button on mobile' };
    })();
  },
}));

const { generateTitle } = await import('../../src/services/agent/title');

describe('generateTitle — model threading', () => {
  it('forwards a custom (non-Anthropic) model id to the SDK query', async () => {
    calls.length = 0;
    const customModel = 'proxy/glm-4.6';

    const title = await generateTitle('first user message', { PATH: '/usr/bin' }, customModel);

    // The cleaned title is returned on success.
    expect(title).toBe('Fix login button on mobile');
    // Exactly one query was issued, and it used the model the caller passed —
    // NOT the hardcoded Anthropic light model.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(customModel);
    expect(calls[0]?.model).not.toBe('claude-haiku-4-5-20251001');
  });

  it('forwards whatever model id the caller supplies', async () => {
    calls.length = 0;
    const lightModel = 'claude-haiku-4-5-20251001';

    await generateTitle('hello', {}, lightModel);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe(lightModel);
  });
});
