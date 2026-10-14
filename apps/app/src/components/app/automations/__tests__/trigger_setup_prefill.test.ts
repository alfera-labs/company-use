import { describe, expect, it } from 'vitest';
import {
  event_prefill,
  schedule_prefill,
} from '@/components/app/automations/trigger_setup_prefill';

describe('schedule_prefill', () => {
  it('reads a weekday cron back into the builder', () => {
    const prefill = schedule_prefill({ kind: 'schedule', cron: '30 9 * * 1,2,3,4,5' });
    expect(prefill.frequency).toBe('every_weekday');
    expect(prefill.draft.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(prefill.advanced_cron).toBeNull();
  });

  it('keeps a cron the builder cannot draw as the raw field', () => {
    const prefill = schedule_prefill({ kind: 'schedule', cron: '0 9 * * 1-5' });
    expect(prefill.frequency).toBe('custom');
    expect(prefill.advanced_cron).toBe('0 9 * * 1-5');
  });
});

describe('event_prefill', () => {
  it('turns the agent-written subscription_config into the form answers', () => {
    expect(
      event_prefill({
        kind: 'app_event',
        node_key: 'composio_gmail-new_gmail_message-1',
        subscription_config: { query: '(technology OR tech)', labelIds: 'INBOX', interval: 5 },
      }),
    ).toEqual({ query: '(technology OR tech)', labelIds: 'INBOX', interval: '5' });
  });
});
