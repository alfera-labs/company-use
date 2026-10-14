import type { BundleManifest } from '@coworker/core/templates/template_object';
import { ValidationError } from '@coworker/shared';

type CredentialPattern = { pattern_name: string; pattern: RegExp };

const credential_patterns: CredentialPattern[] = [
  { pattern_name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { pattern_name: 'aws access key id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
  { pattern_name: 'github token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u },
  { pattern_name: 'slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/u },
  { pattern_name: 'openai key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u },
  { pattern_name: 'anthropic key', pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/u },
  { pattern_name: 'google api key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/u },
  { pattern_name: 'stripe key', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}\b/u },
  { pattern_name: 'json web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./u },
  {
    pattern_name: 'assigned secret',
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9/+_-]{16,}/iu,
  },
  {
    pattern_name: 'url with inline password',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{4,}@/u,
  },
];

export type CredentialFinding = { file_path: string; pattern_name: string };

/** Every credential-shaped string in the bundle's readable text. */
export function find_credentials_in_bundle(manifest: BundleManifest): CredentialFinding[] {
  return manifest.files.flatMap((file) =>
    file.inline_text === undefined
      ? []
      : find_credentials_in_text(file.inline_text).map((pattern_name) => ({
          file_path: file.file_path,
          pattern_name,
        })),
  );
}

function find_credentials_in_text(text: string): string[] {
  return credential_patterns
    .filter(({ pattern }) => pattern.test(text))
    .map(({ pattern_name }) => pattern_name);
}

/** Throws unless the bundle is clean. Called by publish before a row is written. */
export function reject_bundle_with_credentials(manifest: BundleManifest, folder_name: string) {
  const findings = find_credentials_in_bundle(manifest);
  if (findings.length === 0) return;
  const detail = findings
    .map((finding) => `${finding.file_path} (${finding.pattern_name})`)
    .join(', ');
  throw new ValidationError(
    `Folder "${folder_name}" contains credential-shaped content and was not published: ${detail}`,
  );
}
