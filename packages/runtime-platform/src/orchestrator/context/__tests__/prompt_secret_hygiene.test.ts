import {
  key_shaped_value,
  private_key_block,
} from '@coworker/shared/test_support/key_shaped_value';
import { redact_prompt_secrets } from '@runtime-platform/orchestrator/context/prompt_secret_hygiene';
import { describe, expect, it } from 'vitest';

describe('redact_prompt_secrets', () => {
  it('redacts credential-shaped spans across the common vendor formats', () => {
    const cases = [
      'sk-abcdefghijklmnopqrstuvwx1234567890',
      key_shaped_value('stripe_live', 'abcdefghijklmnop1234'),
      key_shaped_value('aws_access_key_id', 'ABCDEFGHIJKLMNOP'),
      `AIza${'b'.repeat(35)}`,
      key_shaped_value('github_personal', '0123456789abcdefghijklmnopqrstuvwxyz'),
      key_shaped_value('slack_bot', '0123456789-abcdefghij'),
    ];

    for (const secret of cases) {
      const scrubbed = redact_prompt_secrets(`the token is ${secret} keep going`);
      expect(scrubbed).not.toContain(secret);
      expect(scrubbed).toContain('[redacted-secret]');
    }
  });

  it('redacts a full PEM private key block', () => {
    const key = private_key_block('RSA PRIVATE KEY', 'MIIBm2Fh+abc\ndef==');
    const scrubbed = redact_prompt_secrets(`config:\n${key}\ndone`);
    expect(scrubbed).not.toContain('PRIVATE KEY');
    expect(scrubbed).toContain('[redacted-secret]');
  });

  it('redacts every secret when a string carries more than one', () => {
    const scrubbed = redact_prompt_secrets(
      `first sk-abcdefghijklmnopqrstuvwx1234567890 then ${key_shaped_value('github_personal', '0123456789abcdefghijklmnopqrstuvwxyz')}`,
    );
    expect(scrubbed).not.toMatch(/sk-|ghp_/);
    expect(scrubbed.match(/\[redacted-secret\]/g)).toHaveLength(2);
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'Book the Skagen room and remember AI is spelled with two letters, not a key.';
    expect(redact_prompt_secrets(prose)).toBe(prose);
  });

  it('is idempotent: scrubbing already-scrubbed text is a no-op', () => {
    const once = redact_prompt_secrets('token sk-abcdefghijklmnopqrstuvwx1234567890');
    expect(redact_prompt_secrets(once)).toBe(once);
  });
});
