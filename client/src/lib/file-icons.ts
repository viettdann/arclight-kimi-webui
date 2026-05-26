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
  // Web frameworks
  vue: { label: 'VUE', className: 'text-emerald-500' },
  svelte: { label: 'SVTE', className: 'text-orange-500' },
  astro: { label: 'ASTR', className: 'text-orange-400' },
  // Markup / data
  md: { label: 'MD', className: 'text-blue-400' },
  mdx: { label: 'MDX', className: 'text-blue-400' },
  json: { label: 'JSON', className: 'text-amber-500' },
  jsonl: { label: 'JSONL', className: 'text-amber-500' },
  json5: { label: 'JSON5', className: 'text-amber-500' },
  toml: { label: 'TOML', className: 'text-orange-500' },
  yaml: { label: 'YML', className: 'text-rose-400' },
  yml: { label: 'YML', className: 'text-rose-400' },
  xml: { label: 'XML', className: 'text-orange-400' },
  html: { label: 'HTML', className: 'text-orange-500' },
  htm: { label: 'HTML', className: 'text-orange-500' },
  css: { label: 'CSS', className: 'text-blue-500' },
  scss: { label: 'SCSS', className: 'text-pink-500' },
  sass: { label: 'SASS', className: 'text-pink-500' },
  less: { label: 'LESS', className: 'text-indigo-500' },
  // Lang
  py: { label: 'PY', className: 'text-emerald-500' },
  pyi: { label: 'PYI', className: 'text-emerald-500' },
  ipynb: { label: 'IPYN', className: 'text-orange-400' },
  rs: { label: 'RS', className: 'text-orange-500' },
  go: { label: 'GO', className: 'text-cyan-500' },
  java: { label: 'JAVA', className: 'text-red-500' },
  kt: { label: 'KT', className: 'text-purple-500' },
  kts: { label: 'KTS', className: 'text-purple-500' },
  scala: { label: 'SCAL', className: 'text-red-500' },
  c: { label: 'C', className: 'text-blue-400' },
  h: { label: 'H', className: 'text-blue-400' },
  cpp: { label: 'C++', className: 'text-blue-500' },
  cc: { label: 'C++', className: 'text-blue-500' },
  hpp: { label: 'H++', className: 'text-blue-500' },
  cs: { label: 'C#', className: 'text-purple-500' },
  rb: { label: 'RB', className: 'text-red-500' },
  php: { label: 'PHP', className: 'text-indigo-400' },
  swift: { label: 'SWIFT', className: 'text-orange-500' },
  dart: { label: 'DART', className: 'text-sky-500' },
  lua: { label: 'LUA', className: 'text-blue-500' },
  r: { label: 'R', className: 'text-blue-400' },
  pl: { label: 'PL', className: 'text-indigo-400' },
  ex: { label: 'EX', className: 'text-purple-400' },
  exs: { label: 'EXS', className: 'text-purple-400' },
  erl: { label: 'ERL', className: 'text-red-400' },
  hs: { label: 'HS', className: 'text-purple-500' },
  clj: { label: 'CLJ', className: 'text-emerald-500' },
  elm: { label: 'ELM', className: 'text-sky-500' },
  zig: { label: 'ZIG', className: 'text-orange-500' },
  nim: { label: 'NIM', className: 'text-yellow-500' },
  // Shell / config
  sh: { label: 'SH', className: 'text-emerald-400' },
  bash: { label: 'SH', className: 'text-emerald-400' },
  zsh: { label: 'SH', className: 'text-emerald-400' },
  fish: { label: 'FISH', className: 'text-emerald-400' },
  ps1: { label: 'PS1', className: 'text-blue-400' },
  bat: { label: 'BAT', className: 'text-muted-foreground' },
  cmd: { label: 'CMD', className: 'text-muted-foreground' },
  env: { label: 'ENV', className: 'text-yellow-600' },
  ini: { label: 'INI', className: 'text-muted-foreground' },
  conf: { label: 'CONF', className: 'text-muted-foreground' },
  cfg: { label: 'CFG', className: 'text-muted-foreground' },
  properties: { label: 'PROP', className: 'text-muted-foreground' },
  editorconfig: { label: 'EDIT', className: 'text-muted-foreground' },
  // SQL / DB
  sql: { label: 'SQL', className: 'text-fuchsia-400' },
  db: { label: 'DB', className: 'text-fuchsia-400' },
  sqlite: { label: 'SQLT', className: 'text-fuchsia-400' },
  // Schema / API
  proto: { label: 'PROTO', className: 'text-cyan-500' },
  graphql: { label: 'GQL', className: 'text-pink-500' },
  gql: { label: 'GQL', className: 'text-pink-500' },
  // Build
  gradle: { label: 'GRDL', className: 'text-emerald-500' },
  cmake: { label: 'CMK', className: 'text-zinc-400' },
  // Text
  txt: { label: 'TXT', className: 'text-muted-foreground' },
  log: { label: 'LOG', className: 'text-muted-foreground' },
  // Docs / tabular
  pdf: { label: 'PDF', className: 'text-red-500' },
  csv: { label: 'CSV', className: 'text-emerald-500' },
  tsv: { label: 'TSV', className: 'text-emerald-500' },
  doc: { label: 'DOC', className: 'text-blue-500' },
  docx: { label: 'DOCX', className: 'text-blue-500' },
  xls: { label: 'XLS', className: 'text-emerald-600' },
  xlsx: { label: 'XLSX', className: 'text-emerald-600' },
  ppt: { label: 'PPT', className: 'text-orange-500' },
  pptx: { label: 'PPTX', className: 'text-orange-500' },
  rtf: { label: 'RTF', className: 'text-blue-400' },
  // Images
  png: { label: 'IMG', className: 'text-violet-400' },
  jpg: { label: 'IMG', className: 'text-violet-400' },
  jpeg: { label: 'IMG', className: 'text-violet-400' },
  gif: { label: 'IMG', className: 'text-violet-400' },
  svg: { label: 'SVG', className: 'text-violet-400' },
  webp: { label: 'IMG', className: 'text-violet-400' },
  ico: { label: 'ICO', className: 'text-violet-400' },
  bmp: { label: 'IMG', className: 'text-violet-400' },
  avif: { label: 'IMG', className: 'text-violet-400' },
  heic: { label: 'IMG', className: 'text-violet-400' },
  tiff: { label: 'IMG', className: 'text-violet-400' },
  // Audio / video
  mp3: { label: 'MP3', className: 'text-pink-400' },
  wav: { label: 'WAV', className: 'text-pink-400' },
  flac: { label: 'FLAC', className: 'text-pink-400' },
  mp4: { label: 'MP4', className: 'text-fuchsia-400' },
  mov: { label: 'MOV', className: 'text-fuchsia-400' },
  webm: { label: 'WEBM', className: 'text-fuchsia-400' },
  mkv: { label: 'MKV', className: 'text-fuchsia-400' },
  // Archive
  zip: { label: 'ZIP', className: 'text-amber-500' },
  tar: { label: 'TAR', className: 'text-amber-500' },
  gz: { label: 'GZ', className: 'text-amber-500' },
  tgz: { label: 'TGZ', className: 'text-amber-500' },
  bz2: { label: 'BZ2', className: 'text-amber-500' },
  xz: { label: 'XZ', className: 'text-amber-500' },
  '7z': { label: '7Z', className: 'text-amber-500' },
  rar: { label: 'RAR', className: 'text-amber-500' },
  // Patch / vcs
  patch: { label: 'PTCH', className: 'text-muted-foreground' },
  diff: { label: 'DIFF', className: 'text-muted-foreground' },
  // Editor
  vim: { label: 'VIM', className: 'text-emerald-500' },
  // Other
  lock: { label: 'LOCK', className: 'text-muted-foreground' },
  wasm: { label: 'WASM', className: 'text-indigo-500' },
};

const SPECIAL_BY_BASENAME: Record<string, FileIconSpec> = {
  dockerfile: { label: 'DOCK', className: 'text-sky-500' },
  '.dockerignore': { label: 'DOCK', className: 'text-sky-500' },
  makefile: { label: 'MAKE', className: 'text-zinc-400' },
  'package.json': { label: 'PKG', className: 'text-red-500' },
  'package-lock.json': { label: 'LOCK', className: 'text-muted-foreground' },
  'bun.lock': { label: 'LOCK', className: 'text-muted-foreground' },
  'bun.lockb': { label: 'LOCK', className: 'text-muted-foreground' },
  'pnpm-lock.yaml': { label: 'LOCK', className: 'text-muted-foreground' },
  'yarn.lock': { label: 'LOCK', className: 'text-muted-foreground' },
  'tsconfig.json': { label: 'TSC', className: 'text-sky-500' },
  'biome.json': { label: 'BIOM', className: 'text-emerald-500' },
  'turbo.json': { label: 'TURB', className: 'text-rose-500' },
  'cargo.toml': { label: 'CRGO', className: 'text-orange-500' },
  'cargo.lock': { label: 'LOCK', className: 'text-muted-foreground' },
  'go.mod': { label: 'GO', className: 'text-cyan-500' },
  'go.sum': { label: 'GO', className: 'text-cyan-500' },
  'requirements.txt': { label: 'REQ', className: 'text-emerald-500' },
  'pyproject.toml': { label: 'PYPR', className: 'text-emerald-500' },
  'readme.md': { label: 'README', className: 'text-blue-400' },
  license: { label: 'LIC', className: 'text-muted-foreground' },
  'license.md': { label: 'LIC', className: 'text-muted-foreground' },
  'changelog.md': { label: 'CHLG', className: 'text-blue-400' },
  '.env': { label: 'ENV', className: 'text-yellow-600' },
  '.env.local': { label: 'ENV', className: 'text-yellow-600' },
  '.env.example': { label: 'ENV', className: 'text-yellow-600' },
  '.gitignore': { label: 'GIT', className: 'text-orange-500' },
  '.gitattributes': { label: 'GIT', className: 'text-orange-500' },
  '.npmrc': { label: 'NPMRC', className: 'text-red-500' },
  '.prettierrc': { label: 'PRET', className: 'text-blue-400' },
  '.prettierrc.json': { label: 'PRET', className: 'text-blue-400' },
  '.eslintrc': { label: 'ESL', className: 'text-indigo-500' },
  '.eslintrc.json': { label: 'ESL', className: 'text-indigo-500' },
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
