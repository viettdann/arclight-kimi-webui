import type { ComponentType, SVGProps } from 'react';
import {
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Lock,
  type LucideIcon,
  Package,
  Settings,
  Terminal,
} from 'lucide-react';

// Material Icon Theme — brand-correct icons for file manager.
// unplugin-icons compiles each `~icons/<set>/<name>` import to a React component;
// only the names imported below ship to the bundle.
import IconAngular from '~icons/material-icon-theme/angular';
import IconAstro from '~icons/material-icon-theme/astro';
import IconAudio from '~icons/material-icon-theme/audio';
import IconBiome from '~icons/material-icon-theme/biome';
import IconC from '~icons/material-icon-theme/c';
import IconChangelog from '~icons/material-icon-theme/changelog';
import IconClojure from '~icons/material-icon-theme/clojure';
import IconCmake from '~icons/material-icon-theme/cmake';
import IconConsole from '~icons/material-icon-theme/console';
import IconCpp from '~icons/material-icon-theme/cpp';
import IconCsharp from '~icons/material-icon-theme/csharp';
import IconCss from '~icons/material-icon-theme/css';
import IconDart from '~icons/material-icon-theme/dart';
import IconDatabase from '~icons/material-icon-theme/database';
import IconDiff from '~icons/material-icon-theme/diff';
import IconDocker from '~icons/material-icon-theme/docker';
import IconDocument from '~icons/material-icon-theme/document';
import IconEditorconfig from '~icons/material-icon-theme/editorconfig';
import IconElixir from '~icons/material-icon-theme/elixir';
import IconElm from '~icons/material-icon-theme/elm';
import IconErlang from '~icons/material-icon-theme/erlang';
import IconEslint from '~icons/material-icon-theme/eslint';
import IconExe from '~icons/material-icon-theme/exe';
import IconFolderBase from '~icons/material-icon-theme/folder-base';
import IconGit from '~icons/material-icon-theme/git';
import IconGo from '~icons/material-icon-theme/go';
import IconGoMod from '~icons/material-icon-theme/go-mod';
import IconGradle from '~icons/material-icon-theme/gradle';
import IconGraphql from '~icons/material-icon-theme/graphql';
import IconH from '~icons/material-icon-theme/h';
import IconHaskell from '~icons/material-icon-theme/haskell';
import IconHtml from '~icons/material-icon-theme/html';
import IconImage from '~icons/material-icon-theme/image';
import IconJava from '~icons/material-icon-theme/java';
import IconJavascript from '~icons/material-icon-theme/javascript';
import IconJson from '~icons/material-icon-theme/json';
import IconKotlin from '~icons/material-icon-theme/kotlin';
import IconLess from '~icons/material-icon-theme/less';
import IconLicense from '~icons/material-icon-theme/license';
import IconLockMit from '~icons/material-icon-theme/lock';
import IconLog from '~icons/material-icon-theme/log';
import IconLua from '~icons/material-icon-theme/lua';
import IconMakefile from '~icons/material-icon-theme/makefile';
import IconMarkdown from '~icons/material-icon-theme/markdown';
import IconMdx from '~icons/material-icon-theme/mdx';
import IconNim from '~icons/material-icon-theme/nim';
import IconNodejs from '~icons/material-icon-theme/nodejs';
import IconNpm from '~icons/material-icon-theme/npm';
import IconPdf from '~icons/material-icon-theme/pdf';
import IconPerl from '~icons/material-icon-theme/perl';
import IconPhp from '~icons/material-icon-theme/php';
import IconPowerpoint from '~icons/material-icon-theme/powerpoint';
import IconPowershell from '~icons/material-icon-theme/powershell';
import IconPrettier from '~icons/material-icon-theme/prettier';
import IconPython from '~icons/material-icon-theme/python';
import IconR from '~icons/material-icon-theme/r';
import IconReact from '~icons/material-icon-theme/react';
import IconReadme from '~icons/material-icon-theme/readme';
import IconRuby from '~icons/material-icon-theme/ruby';
import IconRust from '~icons/material-icon-theme/rust';
import IconSass from '~icons/material-icon-theme/sass';
import IconScala from '~icons/material-icon-theme/scala';
import IconSettings from '~icons/material-icon-theme/settings';
import IconSvelte from '~icons/material-icon-theme/svelte';
import IconSvg from '~icons/material-icon-theme/svg';
import IconSwift from '~icons/material-icon-theme/swift';
import IconTable from '~icons/material-icon-theme/table';
import IconTailwindcss from '~icons/material-icon-theme/tailwindcss';
import IconToml from '~icons/material-icon-theme/toml';
import IconTsconfig from '~icons/material-icon-theme/tsconfig';
import IconTune from '~icons/material-icon-theme/tune';
import IconTurborepo from '~icons/material-icon-theme/turborepo';
import IconTypescript from '~icons/material-icon-theme/typescript';
import IconTypescriptDef from '~icons/material-icon-theme/typescript-def';
import IconVideo from '~icons/material-icon-theme/video';
import IconVim from '~icons/material-icon-theme/vim';
import IconVue from '~icons/material-icon-theme/vue';
import IconWebassembly from '~icons/material-icon-theme/webassembly';
import IconWord from '~icons/material-icon-theme/word';
import IconXml from '~icons/material-icon-theme/xml';
import IconYaml from '~icons/material-icon-theme/yaml';
import IconZig from '~icons/material-icon-theme/zig';
import IconZip from '~icons/material-icon-theme/zip';

export type BrandIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface FileIconSpec {
  /** Generic lucide icon for the timeline (paints in Tailwind color). */
  Icon: LucideIcon;
  /** Tailwind text-color class applied to the lucide icon. */
  className: string;
  /** Brand-accurate material-icon-theme icon for the file manager. */
  Brand: BrandIcon;
  /** Short label kept for aria/tooltip use. */
  label: string;
}

export const FolderBrand: BrandIcon = IconFolderBase;

const TABLE: Record<string, FileIconSpec> = {
  // TypeScript / JavaScript
  ts: { Icon: FileCode, className: 'text-sky-500', Brand: IconTypescript, label: 'TS' },
  tsx: { Icon: FileCode, className: 'text-sky-400', Brand: IconReact, label: 'TSX' },
  'd.ts': { Icon: FileCode, className: 'text-sky-500', Brand: IconTypescriptDef, label: 'DTS' },
  js: { Icon: FileCode, className: 'text-yellow-500', Brand: IconJavascript, label: 'JS' },
  jsx: { Icon: FileCode, className: 'text-yellow-400', Brand: IconReact, label: 'JSX' },
  mjs: { Icon: FileCode, className: 'text-yellow-500', Brand: IconJavascript, label: 'MJS' },
  cjs: { Icon: FileCode, className: 'text-yellow-500', Brand: IconJavascript, label: 'CJS' },
  // Web frameworks
  vue: { Icon: FileCode, className: 'text-emerald-500', Brand: IconVue, label: 'VUE' },
  svelte: { Icon: FileCode, className: 'text-orange-500', Brand: IconSvelte, label: 'SVTE' },
  astro: { Icon: FileCode, className: 'text-orange-400', Brand: IconAstro, label: 'ASTR' },
  // Markup / data
  md: { Icon: FileText, className: 'text-blue-400', Brand: IconMarkdown, label: 'MD' },
  mdx: { Icon: FileText, className: 'text-blue-400', Brand: IconMdx, label: 'MDX' },
  json: { Icon: FileJson, className: 'text-amber-500', Brand: IconJson, label: 'JSON' },
  jsonl: { Icon: FileJson, className: 'text-amber-500', Brand: IconJson, label: 'JSONL' },
  json5: { Icon: FileJson, className: 'text-amber-500', Brand: IconJson, label: 'JSON5' },
  toml: { Icon: FileJson, className: 'text-orange-500', Brand: IconToml, label: 'TOML' },
  yaml: { Icon: FileJson, className: 'text-rose-400', Brand: IconYaml, label: 'YML' },
  yml: { Icon: FileJson, className: 'text-rose-400', Brand: IconYaml, label: 'YML' },
  xml: { Icon: FileCode, className: 'text-orange-400', Brand: IconXml, label: 'XML' },
  html: { Icon: FileCode, className: 'text-orange-500', Brand: IconHtml, label: 'HTML' },
  htm: { Icon: FileCode, className: 'text-orange-500', Brand: IconHtml, label: 'HTML' },
  css: { Icon: FileCode, className: 'text-blue-500', Brand: IconCss, label: 'CSS' },
  scss: { Icon: FileCode, className: 'text-pink-500', Brand: IconSass, label: 'SCSS' },
  sass: { Icon: FileCode, className: 'text-pink-500', Brand: IconSass, label: 'SASS' },
  less: { Icon: FileCode, className: 'text-indigo-500', Brand: IconLess, label: 'LESS' },
  // Lang
  py: { Icon: FileCode, className: 'text-emerald-500', Brand: IconPython, label: 'PY' },
  pyi: { Icon: FileCode, className: 'text-emerald-500', Brand: IconPython, label: 'PYI' },
  ipynb: { Icon: FileCode, className: 'text-orange-400', Brand: IconPython, label: 'IPYN' },
  rs: { Icon: FileCode, className: 'text-orange-500', Brand: IconRust, label: 'RS' },
  go: { Icon: FileCode, className: 'text-cyan-500', Brand: IconGo, label: 'GO' },
  java: { Icon: FileCode, className: 'text-red-500', Brand: IconJava, label: 'JAVA' },
  kt: { Icon: FileCode, className: 'text-purple-500', Brand: IconKotlin, label: 'KT' },
  kts: { Icon: FileCode, className: 'text-purple-500', Brand: IconKotlin, label: 'KTS' },
  scala: { Icon: FileCode, className: 'text-red-500', Brand: IconScala, label: 'SCAL' },
  c: { Icon: FileCode, className: 'text-blue-400', Brand: IconC, label: 'C' },
  h: { Icon: FileCode, className: 'text-blue-400', Brand: IconH, label: 'H' },
  cpp: { Icon: FileCode, className: 'text-blue-500', Brand: IconCpp, label: 'C++' },
  cc: { Icon: FileCode, className: 'text-blue-500', Brand: IconCpp, label: 'C++' },
  hpp: { Icon: FileCode, className: 'text-blue-500', Brand: IconH, label: 'H++' },
  cs: { Icon: FileCode, className: 'text-purple-500', Brand: IconCsharp, label: 'C#' },
  rb: { Icon: FileCode, className: 'text-red-500', Brand: IconRuby, label: 'RB' },
  php: { Icon: FileCode, className: 'text-indigo-400', Brand: IconPhp, label: 'PHP' },
  swift: { Icon: FileCode, className: 'text-orange-500', Brand: IconSwift, label: 'SWIFT' },
  dart: { Icon: FileCode, className: 'text-sky-500', Brand: IconDart, label: 'DART' },
  lua: { Icon: FileCode, className: 'text-blue-500', Brand: IconLua, label: 'LUA' },
  r: { Icon: FileCode, className: 'text-blue-400', Brand: IconR, label: 'R' },
  pl: { Icon: FileCode, className: 'text-indigo-400', Brand: IconPerl, label: 'PL' },
  ex: { Icon: FileCode, className: 'text-purple-400', Brand: IconElixir, label: 'EX' },
  exs: { Icon: FileCode, className: 'text-purple-400', Brand: IconElixir, label: 'EXS' },
  erl: { Icon: FileCode, className: 'text-red-400', Brand: IconErlang, label: 'ERL' },
  hs: { Icon: FileCode, className: 'text-purple-500', Brand: IconHaskell, label: 'HS' },
  clj: { Icon: FileCode, className: 'text-emerald-500', Brand: IconClojure, label: 'CLJ' },
  elm: { Icon: FileCode, className: 'text-sky-500', Brand: IconElm, label: 'ELM' },
  zig: { Icon: FileCode, className: 'text-orange-500', Brand: IconZig, label: 'ZIG' },
  nim: { Icon: FileCode, className: 'text-yellow-500', Brand: IconNim, label: 'NIM' },
  // Shell / config
  sh: { Icon: Terminal, className: 'text-emerald-400', Brand: IconConsole, label: 'SH' },
  bash: { Icon: Terminal, className: 'text-emerald-400', Brand: IconConsole, label: 'SH' },
  zsh: { Icon: Terminal, className: 'text-emerald-400', Brand: IconConsole, label: 'SH' },
  fish: { Icon: Terminal, className: 'text-emerald-400', Brand: IconConsole, label: 'FISH' },
  ps1: { Icon: Terminal, className: 'text-blue-400', Brand: IconPowershell, label: 'PS1' },
  bat: { Icon: Terminal, className: 'text-muted-foreground', Brand: IconExe, label: 'BAT' },
  cmd: { Icon: Terminal, className: 'text-muted-foreground', Brand: IconExe, label: 'CMD' },
  env: { Icon: Settings, className: 'text-yellow-600', Brand: IconTune, label: 'ENV' },
  ini: { Icon: Settings, className: 'text-muted-foreground', Brand: IconSettings, label: 'INI' },
  conf: { Icon: Settings, className: 'text-muted-foreground', Brand: IconSettings, label: 'CONF' },
  cfg: { Icon: Settings, className: 'text-muted-foreground', Brand: IconSettings, label: 'CFG' },
  properties: { Icon: Settings, className: 'text-muted-foreground', Brand: IconSettings, label: 'PROP' },
  editorconfig: { Icon: Settings, className: 'text-muted-foreground', Brand: IconEditorconfig, label: 'EDIT' },
  // SQL / DB
  sql: { Icon: Database, className: 'text-fuchsia-400', Brand: IconDatabase, label: 'SQL' },
  db: { Icon: Database, className: 'text-fuchsia-400', Brand: IconDatabase, label: 'DB' },
  sqlite: { Icon: Database, className: 'text-fuchsia-400', Brand: IconDatabase, label: 'SQLT' },
  // Schema / API
  proto: { Icon: FileCode, className: 'text-cyan-500', Brand: IconDocument, label: 'PROTO' },
  graphql: { Icon: FileCode, className: 'text-pink-500', Brand: IconGraphql, label: 'GQL' },
  gql: { Icon: FileCode, className: 'text-pink-500', Brand: IconGraphql, label: 'GQL' },
  // Build
  gradle: { Icon: FileCode, className: 'text-emerald-500', Brand: IconGradle, label: 'GRDL' },
  cmake: { Icon: FileCode, className: 'text-zinc-400', Brand: IconCmake, label: 'CMK' },
  // Text
  txt: { Icon: FileText, className: 'text-muted-foreground', Brand: IconDocument, label: 'TXT' },
  log: { Icon: FileText, className: 'text-muted-foreground', Brand: IconLog, label: 'LOG' },
  // Docs / tabular
  pdf: { Icon: FileText, className: 'text-red-500', Brand: IconPdf, label: 'PDF' },
  csv: { Icon: FileSpreadsheet, className: 'text-emerald-500', Brand: IconTable, label: 'CSV' },
  tsv: { Icon: FileSpreadsheet, className: 'text-emerald-500', Brand: IconTable, label: 'TSV' },
  doc: { Icon: FileText, className: 'text-blue-500', Brand: IconWord, label: 'DOC' },
  docx: { Icon: FileText, className: 'text-blue-500', Brand: IconWord, label: 'DOCX' },
  xls: { Icon: FileSpreadsheet, className: 'text-emerald-600', Brand: IconTable, label: 'XLS' },
  xlsx: { Icon: FileSpreadsheet, className: 'text-emerald-600', Brand: IconTable, label: 'XLSX' },
  ppt: { Icon: FileText, className: 'text-orange-500', Brand: IconPowerpoint, label: 'PPT' },
  pptx: { Icon: FileText, className: 'text-orange-500', Brand: IconPowerpoint, label: 'PPTX' },
  rtf: { Icon: FileText, className: 'text-blue-400', Brand: IconDocument, label: 'RTF' },
  // Images
  png: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  jpg: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  jpeg: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  gif: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  svg: { Icon: FileImage, className: 'text-violet-400', Brand: IconSvg, label: 'SVG' },
  webp: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  ico: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'ICO' },
  bmp: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  avif: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  heic: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  tiff: { Icon: FileImage, className: 'text-violet-400', Brand: IconImage, label: 'IMG' },
  // Audio / video
  mp3: { Icon: FileAudio, className: 'text-pink-400', Brand: IconAudio, label: 'MP3' },
  wav: { Icon: FileAudio, className: 'text-pink-400', Brand: IconAudio, label: 'WAV' },
  flac: { Icon: FileAudio, className: 'text-pink-400', Brand: IconAudio, label: 'FLAC' },
  mp4: { Icon: FileVideo, className: 'text-fuchsia-400', Brand: IconVideo, label: 'MP4' },
  mov: { Icon: FileVideo, className: 'text-fuchsia-400', Brand: IconVideo, label: 'MOV' },
  webm: { Icon: FileVideo, className: 'text-fuchsia-400', Brand: IconVideo, label: 'WEBM' },
  mkv: { Icon: FileVideo, className: 'text-fuchsia-400', Brand: IconVideo, label: 'MKV' },
  // Archive
  zip: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'ZIP' },
  tar: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'TAR' },
  gz: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'GZ' },
  tgz: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'TGZ' },
  bz2: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'BZ2' },
  xz: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'XZ' },
  '7z': { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: '7Z' },
  rar: { Icon: FileArchive, className: 'text-amber-500', Brand: IconZip, label: 'RAR' },
  // Patch / vcs
  patch: { Icon: FileText, className: 'text-muted-foreground', Brand: IconDiff, label: 'PTCH' },
  diff: { Icon: FileText, className: 'text-muted-foreground', Brand: IconDiff, label: 'DIFF' },
  // Editor
  vim: { Icon: FileCode, className: 'text-emerald-500', Brand: IconVim, label: 'VIM' },
  // Other
  lock: { Icon: FileLock, className: 'text-muted-foreground', Brand: IconLockMit, label: 'LOCK' },
  wasm: { Icon: FileCode, className: 'text-indigo-500', Brand: IconWebassembly, label: 'WASM' },
};

const SPECIAL_BY_BASENAME: Record<string, FileIconSpec> = {
  dockerfile: { Icon: FileCode, className: 'text-sky-500', Brand: IconDocker, label: 'DOCK' },
  '.dockerignore': { Icon: FileCode, className: 'text-sky-500', Brand: IconDocker, label: 'DOCK' },
  makefile: { Icon: FileCode, className: 'text-zinc-400', Brand: IconMakefile, label: 'MAKE' },
  'package.json': { Icon: Package, className: 'text-red-500', Brand: IconNodejs, label: 'PKG' },
  'package-lock.json': { Icon: Lock, className: 'text-muted-foreground', Brand: IconNpm, label: 'LOCK' },
  'bun.lock': { Icon: Lock, className: 'text-muted-foreground', Brand: IconLockMit, label: 'LOCK' },
  'bun.lockb': { Icon: Lock, className: 'text-muted-foreground', Brand: IconLockMit, label: 'LOCK' },
  'pnpm-lock.yaml': { Icon: Lock, className: 'text-muted-foreground', Brand: IconLockMit, label: 'LOCK' },
  'yarn.lock': { Icon: Lock, className: 'text-muted-foreground', Brand: IconLockMit, label: 'LOCK' },
  'tsconfig.json': { Icon: FileJson, className: 'text-sky-500', Brand: IconTsconfig, label: 'TSC' },
  'biome.json': { Icon: FileJson, className: 'text-emerald-500', Brand: IconBiome, label: 'BIOM' },
  'turbo.json': { Icon: FileJson, className: 'text-rose-500', Brand: IconTurborepo, label: 'TURB' },
  'cargo.toml': { Icon: Package, className: 'text-orange-500', Brand: IconRust, label: 'CRGO' },
  'cargo.lock': { Icon: Lock, className: 'text-muted-foreground', Brand: IconRust, label: 'LOCK' },
  'go.mod': { Icon: Package, className: 'text-cyan-500', Brand: IconGoMod, label: 'GO' },
  'go.sum': { Icon: Lock, className: 'text-cyan-500', Brand: IconGoMod, label: 'GO' },
  'requirements.txt': { Icon: Package, className: 'text-emerald-500', Brand: IconPython, label: 'REQ' },
  'pyproject.toml': { Icon: Package, className: 'text-emerald-500', Brand: IconPython, label: 'PYPR' },
  'readme.md': { Icon: FileText, className: 'text-blue-400', Brand: IconReadme, label: 'README' },
  license: { Icon: FileText, className: 'text-muted-foreground', Brand: IconLicense, label: 'LIC' },
  'license.md': { Icon: FileText, className: 'text-muted-foreground', Brand: IconLicense, label: 'LIC' },
  'changelog.md': { Icon: FileText, className: 'text-blue-400', Brand: IconChangelog, label: 'CHLG' },
  '.env': { Icon: Settings, className: 'text-yellow-600', Brand: IconTune, label: 'ENV' },
  '.env.local': { Icon: Settings, className: 'text-yellow-600', Brand: IconTune, label: 'ENV' },
  '.env.example': { Icon: Settings, className: 'text-yellow-600', Brand: IconTune, label: 'ENV' },
  '.gitignore': { Icon: Settings, className: 'text-orange-500', Brand: IconGit, label: 'GIT' },
  '.gitattributes': { Icon: Settings, className: 'text-orange-500', Brand: IconGit, label: 'GIT' },
  '.npmrc': { Icon: Settings, className: 'text-red-500', Brand: IconNpm, label: 'NPMRC' },
  '.prettierrc': { Icon: Settings, className: 'text-blue-400', Brand: IconPrettier, label: 'PRET' },
  '.prettierrc.json': { Icon: Settings, className: 'text-blue-400', Brand: IconPrettier, label: 'PRET' },
  '.eslintrc': { Icon: Settings, className: 'text-indigo-500', Brand: IconEslint, label: 'ESL' },
  '.eslintrc.json': { Icon: Settings, className: 'text-indigo-500', Brand: IconEslint, label: 'ESL' },
  'tailwind.config.ts': { Icon: FileCode, className: 'text-cyan-400', Brand: IconTailwindcss, label: 'TW' },
  'tailwind.config.js': { Icon: FileCode, className: 'text-cyan-400', Brand: IconTailwindcss, label: 'TW' },
  'angular.json': { Icon: FileJson, className: 'text-red-500', Brand: IconAngular, label: 'NG' },
};

const FALLBACK: FileIconSpec = {
  Icon: File,
  className: 'text-muted-foreground/70',
  Brand: IconDocument,
  label: 'FILE',
};

export function basename(path: string): string {
  if (!path) return '';
  return path.split(/[\\/]/).pop() ?? path;
}

export function getFileIcon(path: string): FileIconSpec {
  if (!path) return FALLBACK;
  const lc = basename(path).toLowerCase();
  if (SPECIAL_BY_BASENAME[lc]) return SPECIAL_BY_BASENAME[lc];
  // Honor compound extensions like `.d.ts` before single-extension lookup.
  const dts = TABLE['d.ts'];
  if (dts && lc.endsWith('.d.ts')) return dts;
  const dot = lc.lastIndexOf('.');
  if (dot < 0) return FALLBACK;
  const ext = lc.slice(dot + 1);
  return TABLE[ext] ?? FALLBACK;
}
