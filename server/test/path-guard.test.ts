import { it } from 'bun:test';

// Real assertions land at MVP-6. These placeholders ensure `bun test` exits 0
// at bootstrap and surface the contract path-guard must satisfy.

const todo = () => {};

it.todo('rejects NUL byte (\\0) in relPath', todo);
it.todo('rejects leading "/" (absolute paths)', todo);
it.todo('rejects ".." that escapes userRoot', todo);
it.todo('rejects symlink whose realpath escapes userRoot', todo);
it.todo('accepts a valid nested relPath under userRoot', todo);
