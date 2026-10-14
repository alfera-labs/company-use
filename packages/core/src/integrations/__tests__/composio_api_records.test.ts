import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composio_tool_schema } from '@coworker/core/integrations/composio_api_records';
import { describe, expect, it } from 'vitest';

function read_fixture(file_name: string): unknown {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', file_name), 'utf8'));
}

describe('composio_tool_schema', () => {
  it('reads a null list, flag, or schema as its empty default', () => {
    const tool = composio_tool_schema.parse({
      slug: 'GMAIL_SEND_EMAIL',
      name: 'Send email',
      toolkit: { slug: 'gmail' },
      description: null,
      scopes: null,
      tags: null,
      available_versions: null,
      no_auth: null,
      is_deprecated: null,
      input_parameters: null,
      output_parameters: null,
    });

    expect(tool).toMatchObject({
      description: '',
      scopes: [],
      tags: [],
      available_versions: [],
      no_auth: false,
      is_deprecated: false,
      input_parameters: {},
      output_parameters: {},
    });
  });

  it('keeps a bare scope string in all_of as the provider sent it', () => {
    const tool = composio_tool_schema.parse({
      slug: 'GMAIL_SEND_EMAIL',
      name: 'Send email',
      toolkit: { slug: 'gmail' },
      scope_requirements: { all_of: ['gmail.send', { any_of: ['gmail.read', 'gmail.modify'] }] },
    });

    expect(tool.scope_requirements?.all_of).toEqual([
      'gmail.send',
      { any_of: ['gmail.read', 'gmail.modify'] },
    ]);
  });

  it('reads alternatives that each need several scopes, from a recorded Composio tool', () => {
    const recorded = read_fixture('composio_hubspot_update_list_memberships.json') as {
      scope_requirements: unknown;
    };

    const tool = composio_tool_schema.parse(recorded);

    expect(tool.scope_requirements).toEqual(recorded.scope_requirements);
  });

  it('refuses a requirement that is neither a scope nor an all_of or any_of group', () => {
    const parsed = composio_tool_schema.safeParse({
      slug: 'HUBSPOT_UPDATE_LIST_MEMBERSHIPS',
      name: 'Update list memberships',
      toolkit: { slug: 'hubspot' },
      scope_requirements: { all_of: [{ any_of: [42] }] },
    });

    expect(parsed.success).toBe(false);
  });
});
