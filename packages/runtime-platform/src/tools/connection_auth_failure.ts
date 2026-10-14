// A downstream provider refusing our saved credential does NOT arrive as an HTTP error.
// The app provider calls Google, Google says no, the provider returns 200 carrying Google's
// refusal as text. The error mapper only sees the transport status, so nothing notices, the
// connection keeps reporting health_status 'healthy', and the agent is left to work it out by
// reading English.
//
// Without this, one simple request burns several tool calls: refresh attempts against hosts a
// provider-held connection does not have, a connections list, and a retry, before the agent
// concludes the token is dead. The connections list says `health_status: "healthy"` throughout.
//
// Matching is on distinctive provider phrasing, never a bare word: a Gmail search for the word
// "unauthorized" must not mark a working connection dead. Every pattern here is a phrase a
// provider emits when refusing a credential and that ordinary content does not contain.

const credential_refusal_patterns: readonly { pattern: RegExp; provider_hint: string }[] = [
  { pattern: /invalid authentication credentials/i, provider_hint: 'google' },
  { pattern: /expected oauth\s*2 access token/i, provider_hint: 'google' },
  {
    pattern: /"(?:message|error|reason|status)"\s*:\s*"invalid credentials"/i,
    provider_hint: 'google',
  },
  { pattern: /"error"\s*:\s*"invalid_grant"/i, provider_hint: 'oauth2' },
  { pattern: /"error"\s*:\s*"invalid_token"/i, provider_hint: 'oauth2' },
  { pattern: /\btoken has been expired or revoked\b/i, provider_hint: 'oauth2' },
  { pattern: /"error"\s*:\s*"invalid_auth"/i, provider_hint: 'slack' },
  { pattern: /"error"\s*:\s*"token_revoked"/i, provider_hint: 'slack' },
  { pattern: /"error"\s*:\s*"account_inactive"/i, provider_hint: 'slack' },
  { pattern: /"message"\s*:\s*"bad credentials"/i, provider_hint: 'github' },
  { pattern: /\bapi token is invalid\b/i, provider_hint: 'generic' },
  { pattern: /\binvalid api key\b/i, provider_hint: 'api_key' },
  {
    pattern: /\bauthentication (?:token )?(?:is )?(?:invalid|expired)\b/i,
    provider_hint: 'generic',
  },
];

export type ConnectionAuthFailure = {
  matched_text: string;
  provider_hint: string;
};

const searched_prefix_chars = 20_000;

export function find_connection_auth_failure(output: unknown): ConnectionAuthFailure | null {
  const text = serialize_for_matching(output);
  if (!text) return null;

  for (const { pattern, provider_hint } of credential_refusal_patterns) {
    const match = pattern.exec(text);
    if (match) return { matched_text: match[0], provider_hint };
  }

  return null;
}

function serialize_for_matching(output: unknown): string {
  if (typeof output === 'string') return output.slice(0, searched_prefix_chars);
  if (output === null || output === undefined) return '';
  try {
    return (JSON.stringify(output) ?? '').slice(0, searched_prefix_chars);
  } catch {
    return '';
  }
}
