// Slug rules: trim → NFD normalize → strip combining marks → lowercase →
// replace any non-[a-z0-9_-] with '-' → collapse runs → strip leading/trailing
// '-'. Returns null if the result would be empty, would equal '.' / '..',
// or if the trimmed input exceeds MAX_PROJECT_NAME_LEN. The output is therefore
// safe to use as a single path segment under userRoot.

export const MAX_PROJECT_NAME_LEN = 60;

export function slugifyProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_NAME_LEN) return null;

  const slug = trimmed
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) return null;
  if (slug === '.' || slug === '..') return null;
  return slug;
}
