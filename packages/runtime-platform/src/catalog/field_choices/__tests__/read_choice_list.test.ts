import { read_choice_list } from '@runtime-platform/catalog/field_choices/read_choice_list';
import { describe, expect, it } from 'vitest';

describe('provider trigger choices', () => {
  it('reads nested paths, sorts labels, and removes duplicate values', () => {
    expect(
      read_choice_list(
        {
          data: {
            options: [
              { item: { id: 'two', label: 'Zebra' } },
              { item: { id: 'one', label: 'Apple' } },
              { item: { id: 'one', label: 'Apple duplicate' } },
            ],
          },
        },
        {
          action_node_name: 'list_labels',
          items_path: ['data', 'options'],
          value_path: ['item', 'id'],
          label_path: ['item', 'label'],
        },
      ),
    ).toEqual([
      { value: 'one', label: 'Apple' },
      { value: 'two', label: 'Zebra' },
    ]);
  });

  it('maps calendar ids and summaries from the assumed calendar action shape', () => {
    expect(
      read_choice_list(
        { calendars: [{ id: 'primary', summary: 'My calendar' }] },
        {
          action_node_name: 'list_calendars',
          items_path: ['calendars'],
          value_path: ['id'],
          label_path: ['summary'],
        },
      ),
    ).toEqual([{ value: 'primary', label: 'My calendar' }]);
  });

  it('walks the keys it is given, even one with a dot in it', () => {
    expect(
      read_choice_list(
        { 'data.v2': [{ id: 'x', name: 'X' }] },
        {
          action_node_name: 'list',
          items_path: ['data.v2'],
          value_path: ['id'],
          label_path: ['name'],
        },
      ),
    ).toEqual([{ value: 'x', label: 'X' }]);
  });

  it('keeps a number id as text, and leaves out an item with no value at all', () => {
    expect(
      read_choice_list(
        { labels: [{ id: 7, name: 'Seven' }, { name: 'No id' }] },
        {
          action_node_name: 'list',
          items_path: ['labels'],
          value_path: ['id'],
          label_path: ['name'],
        },
      ),
    ).toEqual([{ value: '7', label: 'Seven' }]);
  });

  it('finds the list when the stored path has the data wrapper and the answer does not', () => {
    expect(
      read_choice_list(
        { labels: [{ id: 'INBOX', name: 'Inbox' }] },
        {
          action_node_name: 'list_labels',
          items_path: ['data', 'labels'],
          value_path: ['id'],
          label_path: ['name'],
        },
      ),
    ).toEqual([{ value: 'INBOX', label: 'Inbox' }]);
  });

  it('falls back to the first list in the answer, and to the usual id and name keys', () => {
    expect(
      read_choice_list(
        { response: { items: [{ id: 'C1', title: 'General' }] } },
        {
          action_node_name: 'list',
          items_path: ['channels'],
          value_path: ['channel_id'],
          label_path: ['label'],
        },
      ),
    ).toEqual([{ value: 'C1', label: 'General' }]);
  });

  it('answers an empty list when there is nothing to pick, so the box becomes a text box', () => {
    expect(
      read_choice_list(
        { ok: true },
        {
          action_node_name: 'list',
          items_path: ['labels'],
          value_path: ['id'],
          label_path: ['name'],
        },
      ),
    ).toEqual([]);
  });
});

describe('readable option words', () => {
  it("turns a provider constant into words and keeps a person's own label as spelled", () => {
    expect(
      read_choice_list(
        {
          labels: [
            { id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL' },
            { id: 'INBOX', name: 'INBOX' },
            { id: 'Label_7', name: 'VIP' },
          ],
        },
        {
          action_node_name: 'list_labels',
          items_path: ['labels'],
          value_path: ['id'],
          label_path: ['name'],
        },
      ),
    ).toEqual([
      { value: 'CATEGORY_PERSONAL', label: 'Category personal' },
      { value: 'INBOX', label: 'Inbox' },
      { value: 'Label_7', label: 'VIP' },
    ]);
  });
});
