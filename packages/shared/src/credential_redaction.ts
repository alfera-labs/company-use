export const redacted_credential = '[redacted credential]';

const credential_patterns: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bvck_[A-Za-z0-9_-]{16,}/g,
  /\bak_(?:live|test)_[A-Za-z0-9_-]{8,}/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

const deepest_walk = 12;

export function redact_credentials_in_text(text: string): string {
  return credential_patterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, redacted_credential),
    text,
  );
}

export function redact_credentials(value: unknown): unknown {
  return redact_value(value, 0, new WeakSet());
}

function redact_value(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redact_credentials_in_text(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= deepest_walk) return '[truncated]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => redact_value(entry, depth + 1, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redact_value(entry, depth + 1, seen)]),
  );
}
