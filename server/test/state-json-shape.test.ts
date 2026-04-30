// CI tripwire for the `state.json` artifact produced by the Kimi CLI runtime
// (via `@moonshot-ai/kimi-agent-sdk`). The artifact is *not* a published SDK
// contract; it lives at `~/.kimi/sessions/{md5(workDir)}/{sessionId}/state.json`
// and is consumed defensively by `server/src/services/title.ts::extractTitle`
// to surface a user-visible session title.
//
// IF THIS TEST FAILS: an SDK upgrade has changed the on-disk shape. Update
// `extractTitle` (and this assertion) to match the new field name/shape, then
// reconfirm `title.ts` still produces sane output. Do NOT silence the test.
//
// Gating:
//   - Skipped unless RUN_SDK_INTEGRATION is truthy (CI/maintainer-only).
//   - Additionally skipped when the SDK reports the user is not logged in
//     (`isLoggedIn(tmpShareDir)`) so unauthenticated runs don't flake.
//
// Isolation: a fresh tmp `workDir` and tmp `shareDir` are used per run; the
// real `~/.kimi` is never touched.

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKimiPaths, createSession, isLoggedIn } from '@moonshot-ai/kimi-agent-sdk';

const RUN = Boolean(process.env.RUN_SDK_INTEGRATION);

describe.skipIf(!RUN)('state.json shape (SDK integration tripwire)', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  const makeTmp = async (prefix: string): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  };

  it.skipIf(!RUN || !isLoggedIn(undefined))(
    'state.json is an object with `custom_title: string | null`',
    async () => {
      const workDir = await makeTmp('kimi-workdir-');
      const shareDir = await makeTmp('kimi-share-');

      // Re-check login against the isolated shareDir; conservative skip if the
      // tmp shareDir has no credentials (expected — login state lives in the
      // real ~/.kimi and is not copied over).
      if (!isLoggedIn(shareDir) && !isLoggedIn(undefined)) {
        return;
      }

      const kimi = createSession({ workDir, shareDir });
      try {
        const turn = kimi.prompt('hello, what is 1+1? Reply only the number.');
        for await (const _ev of turn) {
          // drain the event stream; we only care about the artifact on disk
        }
        await turn.result;

        const paths = createKimiPaths(shareDir);
        const stateJsonPath = path.join(paths.sessionDir(workDir, kimi.sessionId), 'state.json');

        const raw = await readFile(stateJsonPath, 'utf8');
        const parsed: unknown = JSON.parse(raw);

        expect(parsed).not.toBeNull();
        expect(typeof parsed).toBe('object');
        expect(Array.isArray(parsed)).toBe(false);

        const obj = parsed as Record<string, unknown>;
        expect(obj).toHaveProperty('custom_title');
        const title = obj.custom_title;
        const ok = title === null || typeof title === 'string';
        expect(ok).toBe(true);
      } finally {
        await kimi.close();
      }
    },
    60_000,
  );
});
