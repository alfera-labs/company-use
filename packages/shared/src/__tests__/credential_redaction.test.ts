import {
  redact_credentials,
  redact_credentials_in_text,
  redacted_credential,
} from '@shared/credential_redaction';
import { key_shaped_value, web_token_shaped_value } from '@shared/test_support/key_shaped_value';
import { describe, expect, it } from 'vitest';

const credentials = {
  openai: key_shaped_value('openai_project', 'abcdefghijklmnop1234567890QRSTUV'),
  anthropic: key_shaped_value('anthropic', 'abcdefghijklmnop1234567890'),
  gateway: 'vck_abcdefghijklmnop1234567890abcd',
  our_api_key: 'ak_live_abcdefghijklmnop1234',
  slack: key_shaped_value('slack_bot', '123456789012-1234567890123-abcdefghijklmnopqrstuvwx'),
  chatgpt: web_token_shaped_value({ sub: '1234567890' }, 'abcdefghijklmnop'),
};

describe('what may leave for a third party', () => {
  it.each(Object.entries(credentials))('never carries a %s credential', (_name, credential) => {
    const redacted = redact_credentials_in_text(`request failed: ${credential} was rejected`);

    expect(redacted).not.toContain(credential);
    expect(redacted).toContain(redacted_credential);
  });

  it('redacts a bearer whoever issued it', () => {
    const redacted = redact_credentials_in_text(
      'Authorization: Bearer aVeryLongOpaqueTokenValue12345',
    );

    expect(redacted).not.toContain('aVeryLongOpaqueTokenValue12345');
  });

  it('finds a credential wherever it is nested in an event', () => {
    const event = {
      exception: {
        values: [{ value: `provider refused ${credentials.openai}` }],
      },
      extra: { model: { api_key: credentials.anthropic } },
      breadcrumbs: [{ message: `calling with ${credentials.gateway}` }],
      contexts: { run: { headers: { authorization: `Bearer ${credentials.chatgpt}` } } },
    };

    const redacted = JSON.stringify(redact_credentials(event));

    for (const credential of Object.values(credentials)) {
      expect(redacted).not.toContain(credential);
    }
  });

  it('leaves the event readable', () => {
    const redacted = redact_credentials({
      exception: { values: [{ type: 'Error', value: `refused ${credentials.openai}` }] },
      tags: { workspace_id: 'ws_12', http_status: 401 },
    }) as {
      exception: { values: { type: string; value: string }[] };
      tags: Record<string, unknown>;
    };

    expect(redacted.exception.values[0]?.type).toBe('Error');
    expect(redacted.exception.values[0]?.value).toBe(`refused ${redacted_credential}`);
    expect(redacted.tags).toEqual({ workspace_id: 'ws_12', http_status: 401 });
  });

  it('does not redact ordinary prose that merely mentions a key', () => {
    const message = 'the api key was rejected; ask the workspace to reconnect';

    expect(redact_credentials_in_text(message)).toBe(message);
  });

  it('copies rather than editing the caller’s object', () => {
    const original = { extra: { key: credentials.openai } };

    redact_credentials(original);

    expect(original.extra.key).toBe(credentials.openai);
  });

  it('drops a cycle rather than reaching back into the original', () => {
    const looping: Record<string, unknown> = { key: credentials.openai };
    looping.self = looping;

    const redacted = redact_credentials(looping) as Record<string, unknown>;

    expect(redacted.self).toBe('[circular]');
    expect(JSON.stringify(redacted)).not.toContain(credentials.openai);
  });

  it('drops a branch deeper than it walks, rather than passing it through', () => {
    let deep: Record<string, unknown> = { key: credentials.openai };
    for (let level = 0; level < 20; level += 1) deep = { nested: deep };

    expect(JSON.stringify(redact_credentials(deep))).not.toContain(credentials.openai);
  });
});
