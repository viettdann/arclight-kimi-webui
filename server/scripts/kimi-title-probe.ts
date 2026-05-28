#!/usr/bin/env bun
/**
 * Probe the title-generation path end-to-end against the live Kimi backend.
 *
 * Reads provider config from DB (same source as title-generate.ts), calls
 * `POST ${baseUrl}/messages` with a tiny payload, prints status + body so
 * you can see exactly why title generation fails before/after a fix.
 *
 * Usage:
 *   bun server/scripts/kimi-title-probe.ts
 */
import { generateTitleViaAnthropic } from '../src/services/title-generate';
import { db } from '../src/db';
import { getKimiConfig } from '../src/services/kimi-config/get-kimi-config';

const row = await getKimiConfig(db);
const alias = row.defaults.model;
const modelEntry = row.models[alias];
const apiModel = modelEntry?.model ?? alias;

console.log('baseUrl :', row.provider.baseUrl);
console.log(
  'apiKey  :',
  row.provider.apiKey
    ? `${row.provider.apiKey.slice(0, 8)}…(${row.provider.apiKey.length})`
    : '(empty)',
);
console.log('model   :', apiModel);
console.log('---');

const userText = 'Add a dark-mode toggle to the navbar';
const assistantText =
  'Sure, I will add a button next to the user menu that toggles a data-theme attribute on <html>.';

try {
  const title = await generateTitleViaAnthropic(
    { baseUrl: row.provider.baseUrl, apiKey: row.provider.apiKey, model: apiModel },
    userText,
    assistantText,
  );
  console.log('SUCCESS title:', title);
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
}

process.exit(0);
