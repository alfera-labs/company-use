import { plain_provider_error } from '@runtime-platform/triggers/provider_error_words';
import { describe, expect, it } from 'vitest';

describe('plain_provider_error', () => {
  it('drops the quoted slug and keeps the bare app word', () => {
    expect(
      plain_provider_error(
        'Polling trigger "GMAIL_EMAIL_SENT_TRIGGER" requested an interval of 0.5 minutes, but the minimum polling interval for GMAIL is 1 minute.',
      ),
    ).toBe(
      'Polling trigger requested an interval of 0.5 minutes, but the minimum polling interval for GMAIL is 1 minute.',
    );
  });

  it('closes the gaps a slug leaves and ends on one period', () => {
    expect(plain_provider_error("Trigger 'SLACK_NEW_MESSAGE'  is not enabled..")).toBe(
      'Trigger is not enabled.',
    );
  });

  it('leaves a sentence with no slug alone', () => {
    expect(plain_provider_error('needs Gmail connected')).toBe('needs Gmail connected');
  });
});
