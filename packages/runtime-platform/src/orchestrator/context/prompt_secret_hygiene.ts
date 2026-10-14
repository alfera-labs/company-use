type SecretPattern = { name: string; match: RegExp };

const secret_patterns: SecretPattern[] = [
  {
    name: 'pem private key block',
    match: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  { name: 'openai key', match: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'stripe secret key', match: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: 'aws access key id', match: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'google api key', match: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'github token', match: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'slack token', match: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    name: 'json web token',
    match: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { name: 'bearer token', match: /\bBearer\s+[A-Za-z0-9._-]{20,}/gi },
];

const redaction_marker = '[redacted-secret]';

export function redact_prompt_secrets(text: string | null | undefined): string {
  if (!text) return '';
  return secret_patterns.reduce(
    (scrubbed, pattern) => scrubbed.replace(pattern.match, redaction_marker),
    text,
  );
}
