import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalMode } from 'shared/types';
import type { ActiveSession } from '../../src/services/session-manager';

// `canUseTool` broadcasts every prompt over WS; mock the broadcaster so the test
// runs without sockets and can assert which event fired. The parked promise is
// then settled by resolving the entry in pendingApprovals / pendingQuestions —
// exactly what the `approve_tool` / `answer_question` WS handlers do.
const broadcasts: Array<{ type: string; payload: unknown }> = [];
mock.module('../../src/lib/ws-broadcast', () => ({
  broadcastEvent: (_active: unknown, type: string, payload: unknown) => {
    broadcasts.push({ type, payload });
    return { type, payload };
  },
}));

const { buildCanUseTool, normalizeQuestions } = await import('../../src/services/agent/approval');
const { SessionManager } = await import('../../src/services/session-manager');

function makeActive(approvalMode: ApprovalMode): ActiveSession {
  const sm = new SessionManager();
  return sm.register({ sessionId: 's1', userId: 'u1', workDir: '/tmp/work', approvalMode });
}

function ctx(signal: AbortSignal, toolUseID = 'tu-1'): Parameters<CanUseTool>[2] {
  return { signal, toolUseID };
}

/** Let the parked-promise executor run before inspecting the pending maps. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('normalizeQuestions', () => {
  it('returns [] when questions is not an array', () => {
    expect(normalizeQuestions({})).toEqual([]);
    expect(normalizeQuestions({ questions: 'nope' })).toEqual([]);
  });

  it('drops entries lacking a string `question` field', () => {
    expect(normalizeQuestions({ questions: [{ header: 'h' }, null, 5] })).toEqual([]);
  });

  it('maps a well-formed question, preserving header + multiSelect', () => {
    const out = normalizeQuestions({
      questions: [
        {
          question: 'Pick one',
          header: 'Choice',
          multiSelect: true,
          options: [{ label: 'A', description: 'first' }, { label: 'B' }],
        },
      ],
    });
    expect(out).toEqual([
      {
        question: 'Pick one',
        header: 'Choice',
        multiSelect: true,
        options: [{ label: 'A', description: 'first' }, { label: 'B' }],
      },
    ]);
  });

  it('drops options without a string label and omits absent optional fields', () => {
    const out = normalizeQuestions({
      questions: [{ question: 'Q', options: [{ description: 'no label' }, { label: 'OK' }] }],
    });
    expect(out).toEqual([{ question: 'Q', options: [{ label: 'OK' }] }]);
  });
});

describe('buildCanUseTool — bypass mode', () => {
  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('allows any non-AskUserQuestion tool without prompting', async () => {
    const active = makeActive('bypass');
    const cb = buildCanUseTool(active);
    const result = await cb(
      'Bash',
      { command: 'rm -rf /tmp/x' },
      ctx(new AbortController().signal),
    );
    expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'rm -rf /tmp/x' } });
    expect(active.pendingApprovals.size).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('still intercepts AskUserQuestion under bypass and injects the answers', async () => {
    const active = makeActive('bypass');
    const cb = buildCanUseTool(active);
    const p = cb(
      'AskUserQuestion',
      { questions: [{ question: 'Q', options: [{ label: 'A' }] }] },
      ctx(new AbortController().signal),
    );
    await tick();
    expect(broadcasts.map((b) => b.type)).toContain('question_request');
    expect(active.pendingQuestions.size).toBe(1);
    const [pending] = [...active.pendingQuestions.values()];
    pending!.resolve({ requestId: pending!.requestId, answers: { Q: 'A' } });
    const result = await p;
    expect(result.behavior).toBe('allow');
    expect((result as any).updatedInput.answers).toEqual({ Q: 'A' });
    expect((result as any).decisionClassification).toBe('user_temporary');
  });
});

describe('buildCanUseTool — safe mode', () => {
  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('auto-allows a read-only tool', async () => {
    const active = makeActive('safe');
    const cb = buildCanUseTool(active);
    const result = await cb(
      'Read',
      { file_path: 'src/index.ts' },
      ctx(new AbortController().signal),
    );
    expect(result).toEqual({ behavior: 'allow', updatedInput: { file_path: 'src/index.ts' } });
    expect(active.pendingApprovals.size).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('auto-allows a vetted read-only Bash command', async () => {
    const active = makeActive('safe');
    const cb = buildCanUseTool(active);
    const result = await cb('Bash', { command: 'ls -la' }, ctx(new AbortController().signal));
    expect(result.behavior).toBe('allow');
  });

  it('falls through to a prompt for a side-effecting tool, then allows on approve', async () => {
    const active = makeActive('safe');
    const cb = buildCanUseTool(active);
    const p = cb(
      'Write',
      { file_path: 'src/x.ts', content: 'x' },
      ctx(new AbortController().signal),
    );
    await tick();
    expect(broadcasts.map((b) => b.type)).toContain('approval_request');
    expect(active.pendingApprovals.size).toBe(1);
    const [pending] = [...active.pendingApprovals.values()];
    pending!.resolve('approve');
    const result = await p;
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: 'src/x.ts', content: 'x' },
    });
  });

  it('prompts for a dangerous Bash command and denies on reject', async () => {
    const active = makeActive('safe');
    const cb = buildCanUseTool(active);
    const p = cb('Bash', { command: 'rm -rf /' }, ctx(new AbortController().signal));
    await tick();
    expect(active.pendingApprovals.size).toBe(1);
    const [pending] = [...active.pendingApprovals.values()];
    pending!.resolve('reject');
    expect(await p).toEqual({ behavior: 'deny', message: 'Denied by user' });
  });
});

describe('buildCanUseTool — ask mode', () => {
  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('prompts for every tool (even read-only) and allows on approve', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const p = cb('Read', { file_path: 'src/index.ts' }, ctx(new AbortController().signal));
    await tick();
    expect(broadcasts.map((b) => b.type)).toContain('approval_request');
    expect(active.pendingApprovals.size).toBe(1);
    const [pending] = [...active.pendingApprovals.values()];
    expect(pending!.payload.action).toBe('Read');
    pending!.resolve('approve');
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { file_path: 'src/index.ts' } });
  });

  it('denies on reject', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const p = cb('Read', { file_path: 'a' }, ctx(new AbortController().signal));
    await tick();
    const [pending] = [...active.pendingApprovals.values()];
    pending!.resolve('reject');
    expect(await p).toEqual({ behavior: 'deny', message: 'Denied by user' });
  });

  it('carries the Bash command on the approval payload', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const p = cb('Bash', { command: 'git push' }, ctx(new AbortController().signal));
    await tick();
    const [pending] = [...active.pendingApprovals.values()];
    expect(pending!.payload.command).toBe('git push');
    pending!.resolve('approve');
    await p;
  });
});

describe('buildCanUseTool — approve_for_session', () => {
  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('remembers the exact target and auto-allows it without re-prompting', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const sig = new AbortController().signal;

    const p1 = cb('Read', { file_path: 'src/index.ts' }, ctx(sig));
    await tick();
    expect(active.pendingApprovals.size).toBe(1);
    [...active.pendingApprovals.values()][0]!.resolve('approve_for_session');
    expect(await p1).toEqual({ behavior: 'allow', updatedInput: { file_path: 'src/index.ts' } });

    // Same target again → no prompt, no broadcast, allowed straight away.
    broadcasts.length = 0;
    const result = await cb('Read', { file_path: 'src/index.ts' }, ctx(sig));
    expect(result).toEqual({ behavior: 'allow', updatedInput: { file_path: 'src/index.ts' } });
    expect(active.pendingApprovals.size).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('still prompts for a different target of the same tool', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const sig = new AbortController().signal;

    const p1 = cb('Read', { file_path: 'abc.ts' }, ctx(sig));
    await tick();
    [...active.pendingApprovals.values()][0]!.resolve('approve_for_session');
    await p1;

    broadcasts.length = 0;
    const p2 = cb('Read', { file_path: 'efg.ts' }, ctx(sig));
    await tick();
    expect(broadcasts.map((b) => b.type)).toContain('approval_request');
    expect(active.pendingApprovals.size).toBe(1);
    [...active.pendingApprovals.values()][0]!.resolve('reject');
    expect(await p2).toEqual({ behavior: 'deny', message: 'Denied by user' });
  });

  it('keys Bash on the leading binary, so later args of the same command auto-allow', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const sig = new AbortController().signal;

    const p1 = cb('Bash', { command: 'npm run test' }, ctx(sig));
    await tick();
    [...active.pendingApprovals.values()][0]!.resolve('approve_for_session');
    await p1;

    broadcasts.length = 0;
    const result = await cb('Bash', { command: 'npm run build' }, ctx(sig));
    expect(result.behavior).toBe('allow');
    expect(broadcasts).toHaveLength(0);
  });

  it('does not remember when the user picks plain approve', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const sig = new AbortController().signal;

    const p1 = cb('Read', { file_path: 'once.ts' }, ctx(sig));
    await tick();
    [...active.pendingApprovals.values()][0]!.resolve('approve');
    await p1;
    expect(active.sessionAllowRules.has('Read:once.ts')).toBe(false);

    broadcasts.length = 0;
    const p2 = cb('Read', { file_path: 'once.ts' }, ctx(sig));
    await tick();
    expect(broadcasts.map((b) => b.type)).toContain('approval_request');
    [...active.pendingApprovals.values()][0]!.resolve('reject');
    await p2;
  });
});

describe('buildCanUseTool — abort handling', () => {
  beforeEach(() => {
    broadcasts.length = 0;
  });

  it('denies immediately when the signal is already aborted (approval path)', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const ac = new AbortController();
    ac.abort();
    const result = await cb('Read', { file_path: 'a' }, ctx(ac.signal));
    expect(result).toEqual({ behavior: 'deny', message: 'aborted' });
    expect(active.pendingApprovals.size).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('denies a question when answers come back empty (drained/aborted)', async () => {
    const active = makeActive('ask');
    const cb = buildCanUseTool(active);
    const p = cb(
      'AskUserQuestion',
      { questions: [{ question: 'Q', options: [{ label: 'A' }] }] },
      ctx(new AbortController().signal),
    );
    await tick();
    const [pending] = [...active.pendingQuestions.values()];
    pending!.resolve({ requestId: pending!.requestId, answers: {} });
    expect(await p).toEqual({ behavior: 'deny', message: 'aborted' });
  });
});
