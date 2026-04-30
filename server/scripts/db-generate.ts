#!/usr/bin/env bun
// Wrapper: enforce `--name <semantic>` so migration filenames are meaningful
// (no `0001_aimless_namor` accidents). Forwards every arg to drizzle-kit.

const args = Bun.argv.slice(2);

const hasName = args.some((a) => a === '--name' || a.startsWith('--name='));
if (!hasName) {
  process.stderr.write(
    '\n  ✗ db:generate requires --name <semantic_name>\n' +
      '    Example:\n' +
      '      bun run db:generate --name add_user_table\n\n',
  );
  process.exit(1);
}

const proc = Bun.spawn({
  cmd: ['bun', 'x', 'drizzle-kit', 'generate', ...args],
  stdio: ['inherit', 'inherit', 'inherit'],
  env: process.env,
});

process.exit(await proc.exited);
