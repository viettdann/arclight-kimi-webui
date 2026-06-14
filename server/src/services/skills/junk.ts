// Path-based junk filter. We never inspect content (binary support files are
// kept 1:1); a path is junk purely by the names of its segments.

const JUNK_NAMES = new Set<string>([
  '__MACOSX',
  'Thumbs.db',
  'Thumbs.db:encryptable',
  'desktop.ini',
  'ehthumbs.db',
  'ehthumbs_vista.db',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

/**
 * True if any segment of `relPath` is a dotfile/dotfolder (anything starting
 * with `.`) or a known OS junk name. `filter(Boolean)` drops empty segments
 * from doubled/leading/trailing slashes; the explicit `'.'` guard is required
 * because `'.'` is the zip-root sentinel, not a dotfile.
 */
export function isJunkPath(relPath: string): boolean {
  const segments = relPath.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '.') continue; // zip root sentinel, not a dotfile
    if (seg.startsWith('.')) return true; // ._*, .DS_Store, .git, .env, …
    if (JUNK_NAMES.has(seg)) return true;
  }
  return false;
}
