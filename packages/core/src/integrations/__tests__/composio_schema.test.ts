import {
  composio_approval_policy,
  composio_auth_scheme_auth_type,
  list_composio_file_output_paths,
  translate_composio_tool_schema,
} from '@coworker/core/integrations/composio_schema';
import { describe, expect, it } from 'vitest';

describe('translate_composio_tool_schema', () => {
  it('folds the human parameter name and description into title and description', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        record_id: {
          type: 'string',
          human_parameter_name: 'Record',
          human_parameter_description: 'The record this note is attached to, by its Attio id.',
          description: 'record_id',
        },
      },
      required: ['record_id'],
    });

    expect(schema.properties.record_id).toEqual({
      type: 'string',
      title: 'Record',
      description: 'The record this note is attached to, by its Attio id.',
    });
    expect(schema.required).toEqual(['record_id']);
  });

  it('keeps a technical description that already says more than the human one', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          title: 'Search query',
          human_parameter_name: 'Query',
          human_parameter_description: 'Query',
          description: 'A full-text query matched against every indexed record field.',
        },
      },
    });

    expect(schema.properties.query).toEqual({
      type: 'string',
      title: 'Search query',
      description: 'A full-text query matched against every indexed record field.',
    });
  });

  it('collapses a nullable anyOf into its one real branch', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        limit: {
          anyOf: [{ type: 'integer', minimum: 1, maximum: 100 }, { type: 'null' }],
          default: null,
          description: 'How many records to return.',
        },
      },
    });

    expect(schema.properties.limit).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: null,
      description: 'How many records to return.',
    });
  });

  it('turns a file_uploadable object into a workspace file reference string', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        attachment: {
          type: 'object',
          file_uploadable: true,
          description: 'The file to attach.',
          properties: {
            name: { type: 'string' },
            mimetype: { type: 'string' },
            s3key: { type: 'string' },
          },
        },
      },
    });

    expect(schema.properties.attachment).toMatchObject({
      type: 'string',
      field: { file_reference: { accepted_sources: ['workspace_path', 'url'] } },
    });
    const attachment = schema.properties.attachment as { description?: string };
    expect(attachment.description).toContain('The file to attach.');
    expect(attachment.description).toContain('workspace file path');
    expect(attachment.description).toContain('HTTPS URL');
  });

  it('turns an array of file_uploadable objects into an array of file reference strings', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        attachments: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            file_uploadable: true,
            properties: { name: { type: 'string' }, s3key: { type: 'string' } },
          },
        },
      },
    });

    expect(schema.properties.attachments).toMatchObject({
      type: 'array',
      maxItems: 5,
      items: {
        type: 'string',
        field: { file_reference: { accepted_sources: ['workspace_path', 'url'] } },
      },
    });
  });

  it('reads a file_uploadable field wrapped in anyOf as one or many files', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        attachments: {
          anyOf: [
            {
              type: 'object',
              file_uploadable: true,
              properties: { s3key: { type: 'string' } },
            },
            {
              type: 'array',
              items: {
                type: 'object',
                file_uploadable: true,
                properties: { s3key: { type: 'string' } },
              },
            },
          ],
        },
      },
    });

    expect(schema.properties.attachments).toMatchObject({
      type: 'array',
      items: {
        type: 'string',
        field: { file_reference: { accepted_sources: ['workspace_path', 'url'] } },
      },
    });
    expect(schema.properties.attachments).not.toHaveProperty('anyOf');
  });

  it('normalizes a root that is not an object schema', () => {
    expect(translate_composio_tool_schema({ type: 'string' })).toEqual({
      type: 'object',
      properties: {},
    });
    expect(translate_composio_tool_schema({})).toEqual({ type: 'object', properties: {} });
  });

  it('keeps standard JSON Schema keywords, including nested ones', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      additionalProperties: false,
      required: ['filters'],
      properties: {
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: ['name', 'email'] },
              value: {
                type: 'string',
                human_parameter_name: 'Value',
                examples: ['acme'],
              },
            },
            required: ['field'],
          },
        },
      },
    });

    expect(schema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['filters'],
      properties: {
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: ['name', 'email'] },
              value: { type: 'string', title: 'Value', examples: ['acme'] },
            },
            required: ['field'],
          },
        },
      },
    });
  });

  it('leaves no human_parameter keys anywhere in the translated schema', () => {
    const schema = translate_composio_tool_schema({
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          human_parameter_name: 'Outer',
          properties: {
            inner: { type: 'string', human_parameter_description: 'Inner value.' },
          },
        },
      },
    });

    expect(JSON.stringify(schema)).not.toContain('human_parameter');
  });
});

describe('list_composio_file_output_paths', () => {
  it('finds every file_downloadable object, including inside arrays', () => {
    const paths = list_composio_file_output_paths({
      type: 'object',
      properties: {
        report: {
          type: 'object',
          file_downloadable: true,
          properties: { s3url: { type: 'string' } },
        },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            file_downloadable: true,
            properties: { s3url: { type: 'string' } },
          },
        },
        summary: { type: 'string' },
      },
    });

    expect(paths).toEqual([['report'], ['attachments', '[]']]);
  });

  it('returns nothing for a schema with no downloadable files', () => {
    expect(
      list_composio_file_output_paths({
        type: 'object',
        properties: { count: { type: 'number' } },
      }),
    ).toEqual([]);
  });
});

describe('composio_approval_policy', () => {
  it('needs no approval for a tool Composio marks read-only', () => {
    expect(composio_approval_policy(['readOnlyHint'])).toEqual({
      mode: 'none',
      reason: 'composio_read_only_hint',
    });
  });

  it('asks a human for every other action', () => {
    expect(composio_approval_policy([])).toEqual({
      mode: 'manual_review',
      reason: 'composio_provider_action_default',
    });
    expect(composio_approval_policy(['destructiveHint'])).toEqual({
      mode: 'manual_review',
      reason: 'composio_provider_action_default',
    });
  });
});

describe('composio_auth_scheme_auth_type', () => {
  it('maps every OAuth flavour to oauth2, NO_AUTH to none, and the rest to api_key', () => {
    expect(composio_auth_scheme_auth_type('OAUTH2')).toBe('oauth2');
    expect(composio_auth_scheme_auth_type('OAUTH1')).toBe('oauth2');
    expect(composio_auth_scheme_auth_type('DCR_OAUTH')).toBe('oauth2');
    expect(composio_auth_scheme_auth_type('S2S_OAUTH2')).toBe('oauth2');
    expect(composio_auth_scheme_auth_type('NO_AUTH')).toBe('none');
    expect(composio_auth_scheme_auth_type('API_KEY')).toBe('api_key');
    expect(composio_auth_scheme_auth_type('BASIC')).toBe('api_key');
    expect(composio_auth_scheme_auth_type('SNOWFLAKE')).toBe('api_key');
  });
});
