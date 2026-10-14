import { read_dot_path } from '@coworker/core/access/trigger_rules';
import {
  default_subject_field_candidates,
  find_trigger_subject_field,
  subject_field_candidates_by_slug_family,
} from '@coworker/core/integrations/trigger_subject_fields';
import { describe, expect, it } from 'vitest';

const sample_payload_by_family: Record<string, { data: Record<string, unknown>; value: string }> = {
  GMAIL_: { data: { id: 'msg_1', thread_id: '17bb03' }, value: '17bb03' },
  OUTLOOK_: {
    data: { event_type: 'created', id: 'evt_1', message: { id: 'm_1', conversation_id: 'conv_9' } },
    value: 'conv_9',
  },
  SLACK_: { data: { ts: '1726.01', thread_ts: '1725.55', text: 'hi' }, value: '1725.55' },
  NOTION_: {
    data: { event_id: 'del_1', page_id: 'pg_7', workspace_name: 'Harbor' },
    value: 'pg_7',
  },
  GITHUB_: { data: { id: 900100, number: 42, title: 'Broken link' }, value: '42' },
  STRIPE_: {
    data: { account: 'acct_1', livemode: false, data: { object: { id: 'ch_77' } } },
    value: 'ch_77',
  },
  HUBSPOT_: { data: { objectId: 512, subscriptionType: 'contact.creation' }, value: '512' },
  GOOGLEDRIVE_: { data: { event_type: 'created', file: { id: 'fil_3' } }, value: 'fil_3' },
  GOOGLECALENDAR_: { data: { event_id: 'evt_88', summary: 'Tasting' }, value: 'evt_88' },
};

function schema_for(data: Record<string, unknown>): Record<string, unknown> {
  const properties = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value && typeof value === 'object' && !Array.isArray(value)
        ? schema_for(value as Record<string, unknown>)
        : { type: 'string' },
    ]),
  );
  return { type: 'object', properties };
}

describe('trigger subject fields', () => {
  it('resolves a path of that family on that family s own payload', () => {
    for (const [family, sample] of Object.entries(sample_payload_by_family)) {
      const field = find_trigger_subject_field({
        trigger_slug: `${family}SOMETHING_HAPPENED`,
        output_schema: schema_for(sample.data),
      });
      expect(subject_field_candidates_by_slug_family[family], family).toContain(field);
      expect(String(read_dot_path(sample.data, field ?? '')), family).toBe(sample.value);
    }
  });

  it('keeps a later candidate when the payload does not describe the first one', () => {
    const comment = { event_id: 'del_2', comment_id: 'cmt_4' };
    expect(
      find_trigger_subject_field({
        trigger_slug: 'NOTION_COMMENT_CREATED',
        output_schema: schema_for(comment),
      }),
    ).toBe('comment_id');
    expect(
      find_trigger_subject_field({
        trigger_slug: 'GOOGLEDRIVE_FILE_UPDATED_TRIGGER',
        output_schema: schema_for({ file_id: 'fil_9', modified_time: 'now' }),
      }),
    ).toBe('file_id');
  });

  it('says nothing rather than inventing a subject for a payload with no conversation', () => {
    expect(
      find_trigger_subject_field({
        trigger_slug: 'GOOGLEDRIVE_FILE_SHARED_PERMISSIONS_ADDED',
        output_schema: schema_for({ event_type: 'shared', new_permissions: 'x' }),
      }),
    ).toBeNull();
    expect(
      find_trigger_subject_field({
        trigger_slug: 'GOOGLEDRIVE_GOOGLE_DRIVE_CHANGES',
        output_schema: { type: 'object', properties: {}, additionalProperties: true },
      }),
    ).toBeNull();
  });

  it('never keys on a per-delivery id', () => {
    expect(subject_field_candidates_by_slug_family.NOTION_).not.toContain('event_id');
    expect(
      find_trigger_subject_field({
        trigger_slug: 'NOTION_PAGE_CREATED',
        output_schema: schema_for({ event_id: 'del_1', page_id: 'pg_7' }),
      }),
    ).toBe('page_id');
    expect(default_subject_field_candidates).not.toContain('event_id');
  });

  it('falls back to the default order for a family nobody has named yet', () => {
    expect(
      find_trigger_subject_field({
        trigger_slug: 'LINEAR_ISSUE_CREATED',
        output_schema: schema_for({ id: 'iss_1', title: 'Broken' }),
      }),
    ).toBe('id');
  });
});
