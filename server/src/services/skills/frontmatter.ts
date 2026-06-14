import { load as loadYaml } from 'js-yaml';

/** Thrown for any malformed/invalid SKILL.md (missing fence, missing/invalid
 *  `name`). The route surfaces the message as a per-skill upload error. */
export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillParseError';
  }
}

// Leading YAML frontmatter fence: `---\n … \n---`. Tolerates CRLF.
const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;

/** Validate a frontmatter `name`; throws SkillParseError on violation. */
export function validateSkillName(name: string): void {
  if (name.length > NAME_MAX) {
    throw new SkillParseError(`skill name "${name}" exceeds ${NAME_MAX} characters`);
  }
  if (!NAME_RE.test(name)) {
    throw new SkillParseError(
      `skill name "${name}" is invalid (must match ^[a-z0-9]+(-[a-z0-9]+)*$)`,
    );
  }
}

/**
 * Parse a SKILL.md from its raw bytes. The body must open with a `---` YAML
 * fence carrying a valid `name`. `description` is the frontmatter `description`
 * (when a non-empty string) else the first non-empty body line. Bytes are
 * decoded UTF-8 only to read the frontmatter; the original bytes are stored
 * verbatim by the caller.
 */
export function parseSkillMd(bytes: Uint8Array): { name: string; description: string } {
  const text = new TextDecoder().decode(bytes);
  const match = text.match(FENCE_RE);
  if (!match) {
    throw new SkillParseError('SKILL.md is missing its YAML frontmatter (--- … ---)');
  }

  let data: unknown;
  try {
    data = loadYaml(match[1] ?? '');
  } catch (err) {
    throw new SkillParseError(
      `SKILL.md frontmatter is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const fm = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const rawName = fm.name;
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    throw new SkillParseError('SKILL.md frontmatter is missing a `name`');
  }
  const name = rawName.trim();
  validateSkillName(name);

  let description = '';
  if (typeof fm.description === 'string' && fm.description.trim() !== '') {
    description = fm.description.trim();
  } else {
    const body = text.slice(match[0].length);
    const firstLine = body.split('\n').find((line) => line.trim().length > 0);
    description = firstLine?.trim() ?? '';
  }

  return { name, description };
}
