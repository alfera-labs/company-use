// Postgres rejects the whole statement over two things JavaScript strings carry happily: the NUL
// byte (0x00), which text and jsonb columns cannot store, and a lone UTF-16 surrogate — half an
// emoji left behind by a truncation or a bad decode — which jsonb refuses as invalid Unicode
// ("low surrogate must follow a high surrogate"). Any value bound for such a column passes
// through here first. NUL bytes are dropped; a lone surrogate becomes U+FFFD (�), the standard
// mark for a character that was damaged before it arrived. Keys are cleaned like values: a
// half-emoji in a key kills the insert just as dead.
// A high half not followed by a low half, or a low half not preceded by a high half. In
// non-unicode mode the regex walks code units, which is exactly the grain surrogates live at.
const lone_surrogates = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function strip_unstorable_characters<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replaceAll('\u0000', '').replace(lone_surrogates, '\uFFFD') as T;
  }
  if (Array.isArray(value)) {
    return value.map(strip_unstorable_characters) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        strip_unstorable_characters(key),
        strip_unstorable_characters(entry),
      ]),
    ) as T;
  }
  return value;
}
