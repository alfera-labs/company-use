import app_definition from '@connectors/apps/gmail/app.json' with { type: 'json' };
import * as execute_module from '@connectors/apps/gmail/list_messages/v1/execute';
import fixtures from '@connectors/apps/gmail/list_messages/v1/fixtures.json' with { type: 'json' };
import node_definition from '@connectors/apps/gmail/list_messages/v1/node.json' with {
  type: 'json',
};
import * as render_module from '@connectors/apps/gmail/list_messages/v1/render_email';
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_app, load_connector_node } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type {
  ConnectorConnection,
  ConnectorNodeContext,
  ConnectorNodeRequest,
} from '@connectors/types';
import { create_logger, type JsonSchema } from '@coworker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = execute_module;

const app = load_connector_app('apps/gmail/app.json', app_definition);

const connection: ConnectorConnection = {
  connection_id: 'conn_gmail_fixture',
  access_token: 'token_gmail',
};

const context: ConnectorNodeContext = {
  app,
  connection: { connection_id: connection.connection_id },
  send_request: <TParsed>(request: ConnectorNodeRequest): Promise<TParsed> =>
    send_connector_http_request<TParsed>({ app, connection, ...request }),
  send_request_for_response: <TParsed>(request: ConnectorNodeRequest) =>
    send_connector_http_response<TParsed>({ app, connection, ...request }),
  fan_out,
  log: create_logger('connectors-gmail-test'),
};

function json_response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stub_gmail_fetch(answer: (url: string) => Response) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return answer(String(url));
    }),
  );
  return urls;
}

function answer_search_then_messages(url: string) {
  if (url.includes('/users/me/labels')) return json_response(fixtures.labels_list);
  if (url.includes('/messages/18f3a1c9b2d40011')) {
    return json_response(fixtures.message_multipart_full);
  }
  if (url.includes('/messages/18f3a1c9b2d40022')) {
    return json_response(fixtures.message_html_only_full);
  }
  if (url.includes('/messages/18f3a1c9b2d40033')) {
    return json_response(fixtures.message_marketing_junk_full);
  }
  if (url.includes('/messages/18f3a1c9b2d40044')) {
    return json_response(fixtures.message_attachment_only_full);
  }
  return json_response(fixtures.messages_list_page_one);
}

async function read_one_message(message_id: string) {
  const output = await execute({ message_ids: [message_id], include_bodies: true }, context);
  const message = output.messages[0];
  if (!message) throw new Error(`The fixture answered no message for ${message_id}`);
  return message;
}

const plain_body = 'Hi Otto,\n\nThe Q3 numbers are attached. Let me know by Friday.\n\nAna\n';
const stripped_html_body =
  'Hi Otto,\nThe Q3 numbers are attached. Ping me & Marta by Friday.\n\nAna';

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gmail-list_messages-1 node.json', () => {
  it('loads through the framework loader and finds its own execute', () => {
    const loaded = load_connector_node(
      'apps/gmail/list_messages/v1/node.json',
      node_definition,
      execute_module,
    );
    expect(loaded.node_key).toBe(node_definition.node_key);
    expect(loaded.execute).toBe(execute);
  });

  it('declares the key its own folder proves, and the code it needs', () => {
    expect(node_definition.node_key).toBe('gmail-list_messages-1');
    expect(node_definition.implementation).toBe('execute');
    expect(node_definition.description).toContain('Gmail search query');
    expect(node_definition.required_scopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
  });

  it('takes the plural input and answers with an array plus a cursor', () => {
    expect(node_definition.input_schema.$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(Object.keys(node_definition.input_schema.properties)).toEqual([
      'query',
      'label_ids',
      'message_ids',
      'cursor',
      'include_bodies',
    ]);
    expect(node_definition.output_schema.required).toEqual(['messages', 'next_cursor']);
    expect(node_definition.output_schema.properties.next_cursor.type).toEqual(['string', 'null']);
  });

  it('keeps the provider ingress open so a new Gmail field is not an outage', () => {
    const message_schema = node_definition.response_schemas.message;
    expect(message_schema.required).toEqual(['id', 'threadId']);
    expect(message_schema).not.toHaveProperty('additionalProperties');
    expect(message_schema.$defs.message_part.properties.parts.items.$ref).toBe(
      '#/$defs/message_part',
    );
  });

  it('accepts every recorded Gmail answer against its own schema', () => {
    const message_schema = node_definition.response_schemas.message as JsonSchema;
    const list_schema = node_definition.response_schemas.list_messages as JsonSchema;
    for (const [name, page] of [
      ['messages_list_page_one', fixtures.messages_list_page_one],
      ['messages_list_last_page', fixtures.messages_list_last_page],
      ['messages_list_empty', fixtures.messages_list_empty],
    ] as const) {
      expect([name, find_json_schema_violation(list_schema, page, 'response')]).toEqual([
        name,
        null,
      ]);
    }
    for (const [name, message] of [
      ['message_multipart_full', fixtures.message_multipart_full],
      ['message_html_only_full', fixtures.message_html_only_full],
      ['message_metadata', fixtures.message_metadata],
      ['message_marketing_junk_full', fixtures.message_marketing_junk_full],
      ['message_attachment_only_full', fixtures.message_attachment_only_full],
    ] as const) {
      expect([name, find_json_schema_violation(message_schema, message, 'response')]).toEqual([
        name,
        null,
      ]);
    }
  });

  it('rejects a Gmail answer that lost a field the node reads', () => {
    const message_schema = node_definition.response_schemas.message as JsonSchema;
    const { threadId: _dropped, ...without_thread } = fixtures.message_metadata;
    expect(find_json_schema_violation(message_schema, without_thread, 'response')).toContain(
      'threadId',
    );
  });
});

describe('gmail-list_messages-1 execute', () => {
  it('searches, then hydrates the page with plain-text bodies', async () => {
    const urls = stub_gmail_fetch(answer_search_then_messages);

    const output = await execute(
      { query: 'from:ana@acme.test newer_than:7d', include_bodies: true },
      context,
    );

    expect(output).toEqual({
      messages: [
        {
          id: '18f3a1c9b2d40011',
          thread_id: '18f3a1c9b2d40011',
          headers: {
            from: 'Ana Sample <ana@acme.test>',
            to: 'otto@alfera.test',
            subject: 'Q3 numbers',
            date: 'Wed, 3 Sep 2026 09:26:40 +0200',
          },
          snippet: 'Hi Otto, The Q3 numbers are attached. Let me know by Friday.',
          body_text: plain_body,
          rendered_text:
            'From: Ana Sample <ana@acme.test>\n' +
            'To: otto@alfera.test\n' +
            'Date: 2026-09-03 09:26 (+02:00)\n' +
            'Subject: Q3 numbers\n' +
            'Labels: UNREAD, INBOX, IMPORTANT\n' +
            '\u{1F4CE} q3-numbers.pdf (application/pdf, 7.2 KB)\n' +
            '\n' +
            'Hi Otto,\n\nThe Q3 numbers are attached. Let me know by Friday.\n\nAna',
          from_name: 'Ana Sample',
          from_address: 'ana@acme.test',
          to: 'otto@alfera.test',
          date: '2026-09-03T09:26:40+02:00',
          label_names: ['UNREAD', 'INBOX', 'IMPORTANT'],
          has_attachments: true,
          attachments: [{ name: 'q3-numbers.pdf', mime_type: 'application/pdf', byte_size: 7420 }],
        },
        {
          id: '18f3a1c9b2d40022',
          thread_id: '18f3a1c0aa9e0099',
          headers: {
            from: 'Marta Neri <marta@acme.test>',
            to: 'otto@alfera.test',
            cc: 'ana@acme.test',
            subject: 'Q3 numbers, HTML only',
            date: 'Wed, 3 Sep 2026 09:28:20 +0200',
          },
          snippet: 'Hi Otto, The Q3 numbers are attached. Ping me &amp; Marta by Friday.',
          body_text: stripped_html_body,
          rendered_text:
            'From: Marta Neri <marta@acme.test>\n' +
            'To: otto@alfera.test\n' +
            'Cc: ana@acme.test\n' +
            'Date: 2026-09-03 09:28 (+02:00)\n' +
            'Subject: Q3 numbers, HTML only\n' +
            'Labels: INBOX, CATEGORY_UPDATES\n' +
            '\n' +
            `${stripped_html_body}`,
          from_name: 'Marta Neri',
          from_address: 'marta@acme.test',
          to: 'otto@alfera.test',
          date: '2026-09-03T09:28:20+02:00',
          label_names: ['INBOX', 'CATEGORY_UPDATES'],
          has_attachments: false,
          attachments: [],
        },
      ],
      next_cursor: '09876543210987654321',
    });

    expect(urls).toHaveLength(4);
    expect(urls[1]).toContain('/users/me/labels');
    expect(urls[0]).toBe(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${node_definition.quirks.page_size}&q=from%3Aana%40acme.test+newer_than%3A7d`,
    );
    expect(urls[2]).toContain('/users/me/messages/18f3a1c9b2d40011?format=full');
  });

  it('asks for metadata only and returns no body when include_bodies is off', async () => {
    const urls = stub_gmail_fetch((url) => {
      if (url.includes('/users/me/labels')) return json_response(fixtures.labels_list);
      return url.includes('/messages/18f3a1c9b2d40011')
        ? json_response(fixtures.message_metadata)
        : json_response(fixtures.messages_list_last_page);
    });

    const output = await execute({ query: 'is:unread' }, context);

    expect(output.messages).toHaveLength(1);
    expect(output.messages[0]?.body_text).toBeUndefined();
    expect(output.messages[0]?.rendered_text).toBeUndefined();
    expect(output.messages[0]?.headers.subject).toBe('Q3 numbers');
    expect(output.next_cursor).toBeNull();
    expect(urls[2]).toContain('format=metadata');
  });

  it('repeats labelIds on the query string instead of joining them', async () => {
    const urls = stub_gmail_fetch(() => json_response(fixtures.messages_list_empty));

    const output = await execute({ label_ids: ['INBOX', 'UNREAD'] }, context);

    expect(output).toEqual({ messages: [], next_cursor: null });
    expect(urls[0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=25',
    );
    expect(urls).toHaveLength(1);
  });

  it('reads named message ids without a search call', async () => {
    const urls = stub_gmail_fetch(answer_search_then_messages);

    const output = await execute(
      { message_ids: ['18f3a1c9b2d40011'], include_bodies: true },
      context,
    );

    expect(output.messages.map((message) => message.id)).toEqual(['18f3a1c9b2d40011']);
    expect(output.next_cursor).toBeNull();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/users/me/labels');
    expect(urls[1]).toContain('/users/me/messages/18f3a1c9b2d40011?format=full');
  });

  it('fails the whole read and names the message when one hydration call fails', async () => {
    stub_gmail_fetch((url) => {
      if (url.includes('/users/me/labels')) return json_response(fixtures.labels_list);
      return url.includes('/messages/18f3a1c9b2d40022')
        ? json_response(fixtures.message_not_found, 404)
        : json_response(fixtures.message_multipart_full);
    });

    await expect(
      execute({ message_ids: ['18f3a1c9b2d40011', '18f3a1c9b2d40022'] }, context),
    ).rejects.toThrow(/Gmail could not read message 18f3a1c9b2d40022/u);
  });
});

describe('gmail-list_messages-1 rendering', () => {
  it('puts a header block over the body, with the labels named and not numbered', async () => {
    stub_gmail_fetch(answer_search_then_messages);

    const message = await read_one_message('18f3a1c9b2d40033');

    expect(message.rendered_text).toBe(
      'From: Ana Sample <ana@acme.test>\n' +
        'To: otto@alfera.test\n' +
        'Cc: Marta Neri <marta@acme.test>\n' +
        'Date: 2026-09-05 14:07 (+02:00)\n' +
        'Subject: Renewal signed\n' +
        'Labels: INBOX, Internal - Alfera, Needs Action\n' +
        '\u{1F4CE} invoice-2026-09.pdf (application/pdf, 50.0 KB)\n' +
        '\n' +
        'Hi Otto,\n\n' +
        'The renewal is signed. Invoice attached.\n\n' +
        'Ana\n\n' +
        '[earlier messages in this thread omitted]',
    );
  });

  it('strips the invisible preheader padding and the runs of blank lines', async () => {
    stub_gmail_fetch(answer_search_then_messages);

    const message = await read_one_message('18f3a1c9b2d40033');

    expect(message.body_text).toMatch(/[\u200C-\u200F\uFEFF]/u);
    expect(message.body_text).toContain('\r\n');
    expect(message.rendered_text).not.toMatch(/[\u200B-\u200F\u2060\uFEFF]/u);
    expect(message.rendered_text).not.toContain('\r');
    expect(message.rendered_text).not.toMatch(/\n{3}/u);
  });

  it('names the quoted thread instead of repeating it', async () => {
    stub_gmail_fetch(answer_search_then_messages);

    const message = await read_one_message('18f3a1c9b2d40033');

    expect(message.rendered_text).not.toContain('Can you confirm the renewal date?');
    expect(message.rendered_text).not.toContain('wrote:');
    expect(message.rendered_text?.endsWith('[earlier messages in this thread omitted]')).toBe(true);
  });

  it('stores an attachment-only mail as a document', async () => {
    stub_gmail_fetch(answer_search_then_messages);

    const message = await read_one_message('18f3a1c9b2d40044');

    expect(message.body_text).toBe('');
    expect(message.rendered_text).toBe(
      'From: noreply-dmarc-support@google.com\n' +
        'To: dmarc@alfera.test\n' +
        'Date: 2026-09-05 16:20 (+02:00)\n' +
        'Subject: Report domain: alfera.test Submitter: google.com\n' +
        'Labels: INBOX, Needs Action\n' +
        '\u{1F4CE} google.com!alfera.test!1757030400!1757116799.xml.gz (application/gzip, 1.3 KB)',
    );
    expect(message.has_attachments).toBe(true);
    expect(message.from_name).toBeNull();
    expect(message.from_address).toBe('noreply-dmarc-support@google.com');
  });

  it('keeps the sender`s own offset, and falls back to internalDate in UTC', async () => {
    stub_gmail_fetch(answer_search_then_messages);

    expect((await read_one_message('18f3a1c9b2d40033')).date).toBe('2026-09-05T14:07:00+02:00');

    const no_date_header = {
      ...fixtures.message_attachment_only_full,
      payload: {
        ...fixtures.message_attachment_only_full.payload,
        headers: fixtures.message_attachment_only_full.payload.headers.filter(
          (header) => header.name !== 'Date',
        ),
      },
    };
    vi.unstubAllGlobals();
    stub_gmail_fetch((url) =>
      json_response(url.includes('/users/me/labels') ? fixtures.labels_list : no_date_header),
    );
    expect((await read_one_message('18f3a1c9b2d40044')).date).toBe('2026-09-05T14:20:00+00:00');
  });

  it('keeps a link url when it strips the html', () => {
    expect(
      execute_module.strip_html_to_plain_text(
        '<p>Sign it <a href="https://alfera.test/renewal">here</a>.</p>',
      ),
    ).toBe('Sign it here (https://alfera.test/renewal) .');
  });

  it('keeps a mail that is nothing but a quote', () => {
    expect(render_module.clean_email_body('> the whole mail\n> is a quote')).toBe(
      '> the whole mail\n> is a quote',
    );
  });
});
