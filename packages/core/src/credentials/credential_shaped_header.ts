const exact_credential_header_names = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);

const credential_word = /key|token|secret|auth|session|credential|password/;

export function is_credential_shaped_header_name(header_name: string): boolean {
  const normalized_name = header_name.toLowerCase();
  return (
    exact_credential_header_names.has(normalized_name) || credential_word.test(normalized_name)
  );
}

export function separate_publishable_headers(headers: Readonly<Record<string, string>>): {
  publishable: Record<string, string>;
  carries_a_credential: Record<string, string>;
} {
  const publishable: Record<string, string> = {};
  const carries_a_credential: Record<string, string> = {};
  for (const [header_name, value] of Object.entries(headers)) {
    if (is_credential_shaped_header_name(header_name)) carries_a_credential[header_name] = value;
    else publishable[header_name] = value;
  }
  return { publishable, carries_a_credential };
}
