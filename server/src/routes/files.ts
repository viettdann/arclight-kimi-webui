import { Hono } from 'hono';

const files = new Hono();

// Stub — implementation lands at MVP-6 (list/read/upload/download).
files.all('*', (c) => c.json({ error: 'files API not implemented (MVP-6)' }, 501));

export default files;
