import { z } from 'zod';

export const port_schema = z.coerce.number().int().min(1).max(65535);

export const boolean_env_schema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

/**
 * An origin as a browser writes it, so two spellings of one address compare equal: the scheme
 * and the host in small letters, no dot at the end of the host, no port the scheme already
 * means, and no path. A value that is no address comes back trimmed and otherwise as it is.
 * `origin_of_address` in deploy/alfera writes an address the same way.
 */
export function normalize_origin(value: string): string {
  const url = URL.parse(value.trim());
  if (!url || url.origin === 'null') return value.trim();
  url.hostname = url.hostname.replace(/\.$/, '');
  return url.origin;
}
