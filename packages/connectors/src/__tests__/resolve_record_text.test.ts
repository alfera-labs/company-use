import type { ConnectorPersonRecord } from '@connectors/sync/read_directory_page';
import { apply_text_resolvers, build_person_directory } from '@connectors/sync/resolve_record_text';
import type { ConnectorSyncTextResolver } from '@connectors/sync_types';
import { describe, expect, it } from 'vitest';

const ada: ConnectorPersonRecord = {
  external_person_id: 'U01',
  display_name: 'Ada Lovelace',
  email: 'ada@example.com',
  person_kind: 'member',
  raw: { id: 'U01' },
};

const mention_resolver: ConnectorSyncTextResolver = {
  pattern: '<@([A-Z0-9]+)>',
  lookup: 'person',
  render: '@{display_name} ({external_person_id})',
};

describe('apply_text_resolvers', () => {
  it('renders a resolver hit as @{display_name} ({external_person_id})', () => {
    const people = build_person_directory([ada]);
    const result = apply_text_resolvers('ping <@U01> about the demo', [mention_resolver], people);
    expect(result).toEqual({ text: 'ping @Ada Lovelace (U01) about the demo', unresolved: 0 });
  });

  it('leaves a lookup miss verbatim and counts it as unresolved', () => {
    const people = build_person_directory([]);
    const result = apply_text_resolvers('ping <@U99> about the demo', [mention_resolver], people);
    expect(result).toEqual({ text: 'ping <@U99> about the demo', unresolved: 1 });
  });

  it('counts one unresolved mention per miss across several matches', () => {
    const people = build_person_directory([ada]);
    const result = apply_text_resolvers('<@U01> and <@U02> and <@U03>', [mention_resolver], people);
    expect(result.unresolved).toBe(2);
    expect(result.text).toBe('@Ada Lovelace (U01) and <@U02> and <@U03>');
  });

  it('rewrites numbered groups only when the resolver has no lookup', () => {
    const bold_resolver: ConnectorSyncTextResolver = {
      pattern: '\\*(\\w+)\\*',
      render: '<b>{1}</b>',
    };
    const result = apply_text_resolvers(
      'say *hi* now',
      [bold_resolver],
      build_person_directory([]),
    );
    expect(result).toEqual({ text: 'say <b>hi</b> now', unresolved: 0 });
  });

  it('renders the {email} placeholder from the resolved person', () => {
    const email_resolver: ConnectorSyncTextResolver = {
      pattern: '<@([A-Z0-9]+)>',
      lookup: 'person',
      render: '{display_name} <{email}>',
    };
    const people = build_person_directory([ada]);
    const result = apply_text_resolvers('reach <@U01> now', [email_resolver], people);
    expect(result).toEqual({ text: 'reach Ada Lovelace <ada@example.com> now', unresolved: 0 });
  });

  it('keeps the last entry when a batch has duplicate external ids', () => {
    const renamed: ConnectorPersonRecord = { ...ada, display_name: 'Ada (renamed)' };
    const people = build_person_directory([ada, renamed]);
    expect(people.get('U01')?.display_name).toBe('Ada (renamed)');
  });
});
