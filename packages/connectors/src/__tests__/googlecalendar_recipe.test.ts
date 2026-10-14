import { googlecalendar_recipe } from '@connectors/composio/recipes/googlecalendar_recipe';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const event_page_payload = {
  response: {
    items: [
      {
        id: 'event_1',
        summary: 'Board sync',
        description: 'Quarterly review',
        htmlLink: 'https://calendar.google.com/event?eid=event_1',
        organizer: { email: 'founder@example.com' },
        attendees: [{ email: 'jane@example.com' }, { email: 'founder@example.com' }],
        updated: '2026-09-30T09:00:00Z',
        status: 'confirmed',
      },
    ],
    nextPageToken: null,
  },
};

describe('googlecalendar_recipe', () => {
  it('reads the event page, identity, title and attendee/organizer relations', () => {
    const event = googlecalendar_recipe.objects.event;
    if (!event) throw new Error('event object missing');
    const items = evaluate_value_expression(event.page.items, event_page_payload);
    const item = (items as unknown[])[0];
    const scope = { item };
    expect(evaluate_value_expression(event.identity, scope)).toBe('event_1');
    expect(evaluate_value_expression(event.title, scope)).toBe('Board sync');
    expect(evaluate_value_expression(event.relationships?.organizer, scope)).toBe(
      'founder@example.com',
    );
    expect(evaluate_value_expression(event.relationships?.attendee, scope)).toEqual([
      'jane@example.com',
      'founder@example.com',
    ]);
  });

  it('falls back to a placeholder title for an untitled event', () => {
    const event = googlecalendar_recipe.objects.event;
    if (!event) throw new Error('event object missing');
    const scope = { item: { id: 'event_2' } };
    expect(evaluate_value_expression(event.title, scope)).toBe('(no title)');
  });
});
