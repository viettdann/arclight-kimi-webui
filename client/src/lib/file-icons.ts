// Extension → short label + Tailwind text color class.
// Letter-badge style (defers simple-icons; bundle stays light).
//
// `label` is rendered inside a small monospaced badge next to a filename.
// Unknown extensions fall back to a neutral "·" with muted color.

export interface FileIconSpec {
  label: string;
  /** Tailwind text-color class (avoid bg — caller paints background). */
  className: string;
}

const TABLE: Record<string, FileIconSpec> = {
  // TypeScript / JavaScript
  ts: { label: 'TS', className: 'text-sky-500' },
  tsx: { label: 'TSX', className: 'text-sky-400' },
  js: { label: 'JS', className: 'text-yellow-500' },
  jsx: { label: 'JSX', className: 'text-yellow-400' },
  mjs: { label: 'JS', className: 'text-yellow-500' },
  cjs: { label: 'JS', className: 'text-yellow-500' },
  // Markup / data
  md: { label: 'MD', className: 'text-blue-400' },
  mdx: { label: 'MDX', className: 'text-blue-400' },
  json: { label: 'JSON', className: 'text-amber-500' },
  jsonl: { label: 'JSONL', className: 'text-amber-500' },
  toml: { label: 'TOML', className: 'text-orange-500' },
  yaml: { label: 'YML', className: 'text-rose-400' },
  yml: { label: 'YML', className: 'text-rose-400' },
  xml: { label: 'XML', className: 'text-orange-400' },
  html: { label: 'HTML', className: 'text-orange-500' },
  css: { label: 'CSS', className: 'text-blue-500' },
  scss: { label: 'SCSS', className: 'text-pink-500' },
  // Lang
  py: { label: 'PY', className: 'text-emerald-500' },
  rs: { label: 'RS', className: 'text-orange-500' },
  go: { label: 'GO', className: 'text-cyan-500' },
  java: { label: 'JAVA', className: 'text-red-500' },
  kt: { label: 'KT', className: 'text-purple-500' },
  c: { label: 'C', className: 'text-blue-400' },
  h: { label: 'H', className: 'text-blue-400' },
  cpp: { label: 'C++', className: 'text-blue-500' },
  cs: { label: 'C#', className: 'text-purple-500' },
  rb: { label: 'RB', className: 'text-red-500' },
  php: { label: 'PHP', className: 'text-indigo-400' },
  swift: { label: 'SWIFT', className: 'text-orange-500' },
  // Shell / config
  sh: { label: 'SH', className: 'text-emerald-400' },
  bash: { label: 'SH', className: 'text-emerald-400' },
  zsh: { label: 'SH', className: 'text-emerald-400' },
  env: { label: 'ENV', className: 'text-yellow-600' },
  dockerfile: { label: 'DOCK', className: 'text-sky-500' },
  // SQL / DB
  sql: { label: 'SQL', className: 'text-fuchsia-400' },
  // Text
  txt: { label: 'TXT', className: 'text-muted-foreground' },
  log: { label: 'LOG', className: 'text-muted-foreground' },
  // Images
  png: { label: 'IMG', className: 'text-violet-400' },
  jpg: { label: 'IMG', className: 'text-violet-400' },
  jpeg: { label: 'IMG', className: 'text-violet-400' },
  gif: { label: 'IMG', className: 'text-violet-400' },
  svg: { label: 'SVG', className: 'text-violet-400' },
  webp: { label: 'IMG', className: 'text-violet-400' },
  // Other
  lock: { label: 'LOCK', className: 'text-muted-foreground' },
};

const SPECIAL_BY_BASENAME: Record<string, FileIconSpec> = {
  dockerfile: { label: 'DOCK', className: 'text-sky-500' },
  makefile: { label: 'MAKE', className: 'text-zinc-400' },
  'package.json': { label: 'PKG', className: 'text-red-500' },
  'tsconfig.json': { label: 'TSC', className: 'text-sky-500' },
  '.env': { label: 'ENV', className: 'text-yellow-600' },
  '.gitignore': { label: 'GIT', className: 'text-orange-500' },
};

const FALLBACK: FileIconSpec = { label: '·', className: 'text-muted-foreground/70' };

export function getFileIcon(path: string): FileIconSpec {
  if (!path) return FALLBACK;
  const basename = path.split(/[\\/]/).pop() ?? path;
  const lc = basename.toLowerCase();
  if (SPECIAL_BY_BASENAME[lc]) return SPECIAL_BY_BASENAME[lc];
  const dot = lc.lastIndexOf('.');
  if (dot < 0) return FALLBACK;
  const ext = lc.slice(dot + 1);
  return TABLE[ext] ?? FALLBACK;
}

export function basename(path: string): string {
  if (!path) return '';
  return path.split(/[\\/]/).pop() ?? path;
}
