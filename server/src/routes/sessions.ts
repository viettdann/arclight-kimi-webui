import { Hono } from 'hono';

const sessions = new Hono();

// Stub — implementation lands at MVP-7 (GET list, POST :id/close).
sessions.all('*', (c) => c.json({ error: 'sessions API not implemented (MVP-7)' }, 501));

export default sessions;
