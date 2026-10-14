import {
  deliver_the_answer,
  is_a_slack_answer_address,
} from '@api/services/channels/slack_click_payload';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the address an answer to a Slack button press is posted to', () => {
  it('is one of Slack own addresses over https, and nothing else', () => {
    expect(is_a_slack_answer_address('https://hooks.slack.com/actions/T1/2/abc')).toBe(true);
    expect(is_a_slack_answer_address('https://hooks.slack-gov.com/actions/T1/2/abc')).toBe(true);
    for (const address of [
      'http://hooks.slack.com/actions/T1/2/abc',
      'https://hooks.slack.com.attacker.example/x',
      'https://postgres:5432/',
      'https://169.254.169.254/latest/meta-data/',
      'http://api:3001/v1/team',
      'not an address',
    ]) {
      expect(is_a_slack_answer_address(address), address).toBe(false);
    }
  });

  it('gets no request when it is not Slack: the answer goes back in the response instead', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    const answer = { text: 'Done.' };

    const left_to_answer = await deliver_the_answer(
      { response_url: 'http://api:3001/internal/run-queued-jobs' },
      answer as Parameters<typeof deliver_the_answer>[1],
    );

    expect(send).not.toHaveBeenCalled();
    expect(left_to_answer).toEqual(answer);
  });
});
