import { format_current_turn_context } from '@runtime-platform/orchestrator/context/current_turn_context';
import { expect, it } from 'vitest';

it('offers the automation to the person in the chat', () => {
  const text = format_current_turn_context({
    source_type: 'web_chat',
    web_chat: { speaker_name: 'Riley' },
  });

  expect(text).toContain('automations-create_automation-1');
  expect(text).toContain('automations-list_automations-1');
  expect(text).toContain('after they say yes');
  expect(text).toContain(
    'Your reply is delivered here, in this web chat, and streamed back to this person. You have every tool available; reach an outward channel (Slack, email) when this conversation or one of your configured automations calls for it, and not on the strength of a memory alone.',
  );
});

it('offers it on Slack and on email too, because a person is there as well', () => {
  const slack = format_current_turn_context({ source_type: 'slack', slack: { channel_id: 'C1' } });
  const email = format_current_turn_context({
    source_type: 'email',
    email: { sender: 'sam@example.com' },
  });

  expect(slack).toContain('automations-create_automation-1');
  expect(email).toContain('automations-create_automation-1');
});
