import { it } from 'bun:test';

// Real assertions land at MVP-4/5.

const todo = () => {};

it.todo('rejects cross-user sessionId access', todo);
it.todo('isolates byUser map per userId', todo);
it.todo('removes session from byUser on close', todo);
