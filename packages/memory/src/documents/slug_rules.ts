import slugify from '@sindresorhus/slugify';

const document_slug_max_characters = 200;

function clamp_to_slug_length(slug: string): string {
  if (slug.length <= document_slug_max_characters) return slug;
  return slug.slice(0, document_slug_max_characters).replace(/-+$/u, '');
}

function title_fingerprint(title: string): string {
  let hash = 2166136261;
  for (let index = 0; index < title.length; index += 1) {
    hash ^= title.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function to_document_slug(title: string): string {
  const slug = slugify(title, { separator: '-' });
  if (slug.length > 0) return clamp_to_slug_length(slug);
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'untitled';
  return clamp_to_slug_length(`untitled-${title_fingerprint(trimmed)}`);
}
