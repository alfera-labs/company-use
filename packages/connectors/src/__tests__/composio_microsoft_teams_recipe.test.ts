import { composio_microsoft_teams_recipe } from '@connectors/composio/recipes/composio_microsoft_teams';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const chat_message_page_payload = {
  response: {
    value: [
      {
        id: 'msg_01',
        created_date_time: '2026-09-25T15:04:00Z',
        body: { content: 'Standup moved to 10am.' },
        from: { user: { id: 'user_teams_01' } },
      },
    ],
  },
};

describe('composio_microsoft_teams_recipe', () => {
  it('maps a chat message to the day bucket and the author relation', () => {
    const chat_day = composio_microsoft_teams_recipe.objects.chat_day;
    if (!chat_day) throw new Error('composio_microsoft_teams_recipe is missing chat_day');
    const items = evaluate_value_expression(chat_day.page.items, chat_message_page_payload);
    const scope = { item: (items as unknown[])[0] };
    expect(evaluate_value_expression(chat_day.identity, scope)).toBe('msg_01');
    expect(evaluate_value_expression(chat_day.content, scope)).toBe('Standup moved to 10am.');
    expect(evaluate_value_expression(chat_day.relationships?.author, scope)).toBe('user_teams_01');
    expect(chat_day.bucket?.by).toBe('day');
    if (chat_day.bucket?.by !== 'day') throw new Error('chat_day bucket is not by day');
    expect(evaluate_value_expression(chat_day.bucket.of, scope)).toBe('2026-09-25T15:04:00Z');
  });

  it('falls back to an empty body when content is missing', () => {
    const chat_day = composio_microsoft_teams_recipe.objects.chat_day;
    if (!chat_day) throw new Error('composio_microsoft_teams_recipe is missing chat_day');
    const scope = { item: { id: 'msg_02', body: {} } };
    expect(evaluate_value_expression(chat_day.content, scope)).toBe('');
  });
});
