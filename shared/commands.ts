// Single source of truth for slash-command classification, shared by the client
// picker and the server dispatch guard. A command is either forwarded to the CLI
// subprocess (`passthrough`) or rejected with a replacement hint (`unsupported`).

export type CommandKind = 'builtin' | 'project' | 'skill';

/** A catalog entry shown in the picker and carried over the wire. */
export interface CommandInfo {
  name: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
  kind: CommandKind;
}

/** Static metadata for a built-in passthrough command. */
export interface CommandSpec {
  name: string;
  description: string;
  argumentHint: string;
}

/**
 * Built-in passthrough commands. Always available to the picker, even on a
 * cold start before the live session reports its dynamic catalog.
 */
export const SUPPORTED_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'compact',
    description: 'Summarize the conversation to free up context',
    argumentHint: '[focus]',
  },
  { name: 'init', description: 'Generate a CLAUDE.md for this project', argumentHint: '' },
];

/** Built-in command names that classify as passthrough. */
export const STATIC_PASSTHROUGH: ReadonlySet<string> = new Set(
  SUPPORTED_COMMANDS.map((c) => c.name),
);

/** Built-in commands as catalog entries, for merging into the picker. */
export const BUILTIN_COMMANDS: readonly CommandInfo[] = SUPPORTED_COMMANDS.map((c) => ({
  ...c,
  kind: 'builtin' as const,
}));

/** Fallback hint for a command that is rejected without a specific message. */
export const UNSUPPORTED_HINT = 'Not supported in the web UI.';

/**
 * Native CLI commands that the web UI does not forward. Each maps to a hint that
 * points the user at the web-native equivalent. Names that share a hint are
 * grouped for readability.
 */
export const BLACKLIST: Readonly<Record<string, string>> = {
  clear: 'Use New Session to start fresh.',
  model: 'Use the model picker in the composer.',
  effort: 'Use the effort control in the composer.',
  files: 'Use the file browser in the sidebar.',
  context: 'Coming soon (sidebar).',
  usage: 'Coming soon (sidebar).',
  mcp: 'Coming soon (sidebar).',
  status: 'Coming soon (sidebar).',
  agents: 'Coming soon (sidebar).',
  rewind: 'Coming soon (sidebar).',
  config: UNSUPPORTED_HINT,
  vim: UNSUPPORTED_HINT,
  login: UNSUPPORTED_HINT,
  logout: UNSUPPORTED_HINT,
  resume: UNSUPPORTED_HINT,
  export: UNSUPPORTED_HINT,
  doctor: UNSUPPORTED_HINT,
  hooks: UNSUPPORTED_HINT,
  'terminal-setup': UNSUPPORTED_HINT,
  permissions: UNSUPPORTED_HINT,
  diff: UNSUPPORTED_HINT,
  memory: UNSUPPORTED_HINT,
  'add-dir': UNSUPPORTED_HINT,
  'privacy-settings': UNSUPPORTED_HINT,
  review: UNSUPPORTED_HINT,
  'security-review': UNSUPPORTED_HINT,
  'pr-comments': UNSUPPORTED_HINT,
};

export type CommandClassification = { type: 'passthrough' } | { type: 'unsupported'; hint: string };

/**
 * Classify a slash-command name.
 *
 * - Blacklisted → `unsupported` with the replacement hint.
 * - Built-in passthrough → `passthrough`.
 * - Otherwise, when the dynamic catalog is known (`dynamic` present): a member
 *   is `passthrough`, anything else is `unsupported`.
 * - When the dynamic catalog is not yet known (`dynamic` omitted), default to
 *   `passthrough` so a cold-start send is not blocked.
 *
 * @param dynamic Names of the session's dynamic commands and skills, or omitted
 *   before the live session has reported its catalog.
 */
export function classifyCommand(
  name: string,
  opts: { dynamic?: readonly string[] } = {},
): CommandClassification {
  const blacklistHint = BLACKLIST[name];
  if (blacklistHint !== undefined) return { type: 'unsupported', hint: blacklistHint };
  if (STATIC_PASSTHROUGH.has(name)) return { type: 'passthrough' };
  if (opts.dynamic !== undefined) {
    return opts.dynamic.includes(name)
      ? { type: 'passthrough' }
      : { type: 'unsupported', hint: UNSUPPORTED_HINT };
  }
  return { type: 'passthrough' };
}

/** Split a slash-command line into its name (without slash) and the remainder. */
export function parseSlashCommand(text: string): { name: string; arg: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const sliced = trimmed.slice(1);
  const spaceIdx = sliced.search(/\s/);
  if (spaceIdx === -1) return { name: sliced, arg: '' };
  return { name: sliced.slice(0, spaceIdx), arg: sliced.slice(spaceIdx + 1).trim() };
}
