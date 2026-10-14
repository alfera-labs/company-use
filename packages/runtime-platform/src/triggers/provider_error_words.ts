const quoted_slug = /\s*["'][A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+["']/g;

export function plain_provider_error(message: string): string {
  return message
    .replace(quoted_slug, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.;:])/g, '$1')
    .replace(/\.{2,}$/, '.')
    .trim();
}
