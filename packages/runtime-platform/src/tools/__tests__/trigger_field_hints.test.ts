import {
  find_trigger_field_hint,
  read_trigger_field_words,
} from '@runtime-platform/tools/trigger_field_hints';
import { describe, expect, it } from 'vitest';

describe('trigger field provider choices', () => {
  it('finds Gmail labels and calendar ids only for their provider apps', () => {
    expect(find_trigger_field_hint('labelIds', 'gmail')?.choices_from).toEqual({
      action_node_name: 'list_labels',
      items_path: ['labels'],
      value_path: ['id'],
      label_path: ['name'],
    });
    expect(find_trigger_field_hint('calendarId', 'googlecalendar')?.choices_from).toMatchObject({
      action_node_name: 'list_calendars',
    });
    expect(read_trigger_field_words('calendarId', 'gmail').choices_from_provider).toBe(false);
    expect(read_trigger_field_words('labelIds', 'gmail').choices_from_provider).toBe(true);
  });
});
