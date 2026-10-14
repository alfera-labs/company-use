import {
  pick_display_name,
  read_directory_page,
  read_directory_person,
  read_person_kind,
} from '@connectors/sync/read_directory_page';
import type { ConnectorSyncDirectory } from '@connectors/sync_types';
import { describe, expect, it } from 'vitest';

function slack_directory(): ConnectorSyncDirectory {
  return {
    list_node: 'slack-list_members-1',
    page: {
      items: { $: 'response.members' },
      next_cursor: { $: 'response.next_cursor' },
    },
    identity: { $: 'item.id' },
    display_name: [{ $: 'item.profile.display_name' }, { $: 'item.profile.real_name' }],
    email: { $: 'item.profile.email' },
    person_kind: { bot: { $: 'item.is_bot' }, guest: { $: 'item.is_restricted' } },
  };
}

describe('pick_display_name', () => {
  it('takes the first non-empty trimmed candidate', () => {
    expect(pick_display_name([' ', '  Ada Lovelace  ', 'fallback'])).toBe('Ada Lovelace');
  });

  it('answers undefined when every candidate is empty or missing', () => {
    expect(pick_display_name([undefined, '  ', null])).toBeUndefined();
  });

  it('accepts a bare string, not only an array', () => {
    expect(pick_display_name('Grace Hopper')).toBe('Grace Hopper');
  });
});

describe('read_person_kind', () => {
  const directory = slack_directory();

  it('reports bot before guest when both flags are set', () => {
    const kind = read_person_kind(directory, { item: { is_bot: true, is_restricted: true } });
    expect(kind).toBe('bot');
  });

  it('reports guest when only the guest flag is set', () => {
    expect(read_person_kind(directory, { item: { is_restricted: true } })).toBe('guest');
  });

  it('falls back to member when neither flag is set', () => {
    expect(read_person_kind(directory, { item: {} })).toBe('member');
  });
});

describe('read_directory_person', () => {
  it('reads identity, the first display name candidate, email, person kind, and the raw item', () => {
    const raw_item = {
      id: 'U01',
      is_bot: false,
      is_restricted: false,
      profile: { display_name: 'Ada', real_name: 'Ada Lovelace', email: 'ada@example.com' },
    };
    const person = read_directory_person(slack_directory(), raw_item);
    expect(person).toEqual({
      external_person_id: 'U01',
      display_name: 'Ada',
      email: 'ada@example.com',
      person_kind: 'member',
      raw: raw_item,
    });
  });

  it('falls through to real_name when display_name is blank', () => {
    const person = read_directory_person(slack_directory(), {
      id: 'U02',
      profile: { display_name: '', real_name: 'Grace Hopper' },
    });
    expect(person.display_name).toBe('Grace Hopper');
  });
});

describe('read_directory_page', () => {
  it('reads one page of people and the next cursor from a raw node answer', () => {
    const first_member = { id: 'U01', is_bot: false, profile: { display_name: 'Ada' } };
    const second_member = { id: 'U02', is_bot: true, profile: { display_name: 'Botty' } };
    const page = read_directory_page(slack_directory(), {
      members: [first_member, second_member],
      next_cursor: 'cur_02',
    });
    expect(page.next_cursor).toBe('cur_02');
    expect(page.people).toEqual([
      {
        external_person_id: 'U01',
        display_name: 'Ada',
        email: undefined,
        person_kind: 'member',
        raw: first_member,
      },
      {
        external_person_id: 'U02',
        display_name: 'Botty',
        email: undefined,
        person_kind: 'bot',
        raw: second_member,
      },
    ]);
  });

  it('drops a row whose identity evaluates to an empty string', () => {
    const page = read_directory_page(slack_directory(), {
      members: [{ id: '', profile: { display_name: 'Nobody' } }],
    });
    expect(page.people).toEqual([]);
  });

  it('answers an empty page when the items path is not an array', () => {
    const page = read_directory_page(slack_directory(), { members: null });
    expect(page.people).toEqual([]);
    expect(page.next_cursor).toBeUndefined();
  });
});
