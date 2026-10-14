import node_definition from '@connectors/apps/gmail/list_messages/v1/node.json' with {
  type: 'json',
};
import {
  type EmailAttachment,
  type EmailHeaders,
  read_address,
  read_email_time,
  render_email,
} from '@connectors/apps/gmail/list_messages/v1/render_email';
import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';
import { format_error_message } from '@coworker/shared';

export type ListMessagesInput = {
  query?: string | undefined;
  label_ids?: string[] | undefined;
  message_ids?: string[] | undefined;
  cursor?: string | undefined;
  include_bodies?: boolean | undefined;
};

type MessageRow = {
  id: string;
  thread_id: string;
  headers: EmailHeaders;
  snippet: string;
  body_text?: string;
  rendered_text?: string;
  from_name: string | null;
  from_address: string | null;
  to: string | null;
  date: string | null;
  label_names: string[];
  has_attachments: boolean;
  attachments: EmailAttachment[];
};

export type ListMessagesOutput = {
  messages: MessageRow[];
  next_cursor: string | null;
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailMessagePart;
};

type GmailLabelsList = {
  labels?: { id: string; name?: string }[];
};

type LabelNames = Map<string, string>;

type ListMessagesPage = {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string | null;
};

const list_messages_schema = node_definition.response_schemas.list_messages as JsonSchema;
const message_schema = node_definition.response_schemas.message as JsonSchema;
const labels_list_schema = node_definition.response_schemas.labels_list as JsonSchema;
const messages_page_size = node_definition.quirks.page_size;

const wanted_header_names = ['from', 'to', 'cc', 'subject', 'date'] as const;

type WantedHeaderName = (typeof wanted_header_names)[number];

function is_wanted_header_name(name: string): name is WantedHeaderName {
  return (wanted_header_names as readonly string[]).includes(name);
}

function pick_wanted_headers(headers: readonly { name: string; value: string }[] = []) {
  const picked: Partial<Record<WantedHeaderName, string>> = {};
  for (const header of headers) {
    const name = header.name.toLowerCase();
    if (is_wanted_header_name(name) && picked[name] === undefined) picked[name] = header.value;
  }
  return picked;
}

function decode_base64url(data: string) {
  return Buffer.from(data, 'base64url').toString('utf8');
}

const html_entity_text: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const html_link = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;

export function strip_html_to_plain_text(html: string) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, '')
    .replace(html_link, (_whole, url: string, text: string) => {
      const label = text.replace(/<[^>]*>/gu, '').trim();
      return label.length === 0 || label === url ? ` ${url} ` : ` ${label} (${url}) `;
    })
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (entity) => html_entity_text[entity] ?? entity)
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function find_body_part(part: GmailMessagePart, mime_prefix: string): GmailMessagePart | null {
  if (!part.filename && part.body?.data && part.mimeType?.startsWith(mime_prefix)) return part;
  for (const child of part.parts ?? []) {
    const found = find_body_part(child, mime_prefix);
    if (found) return found;
  }
  return null;
}

function extract_message_body(payload: GmailMessagePart | undefined): string {
  if (!payload) return '';
  const plain_part = find_body_part(payload, 'text/plain');
  if (plain_part?.body?.data) return decode_base64url(plain_part.body.data);
  const html_part = find_body_part(payload, 'text/html');
  if (html_part?.body?.data) return strip_html_to_plain_text(decode_base64url(html_part.body.data));
  return '';
}

function read_attachments(part: GmailMessagePart | undefined): EmailAttachment[] {
  if (!part) return [];
  const own = part.filename
    ? [
        {
          name: part.filename,
          mime_type: part.mimeType ?? 'application/octet-stream',
          byte_size: typeof part.body?.size === 'number' ? part.body.size : null,
        },
      ]
    : [];
  return [...own, ...(part.parts ?? []).flatMap(read_attachments)];
}

function build_message_row(
  message: GmailMessage,
  include_bodies: boolean,
  label_names: LabelNames,
): MessageRow {
  const headers = pick_wanted_headers(message.payload?.headers);
  const time = read_email_time(headers, message.internalDate);
  const from = read_address(headers.from);
  const attachments = read_attachments(message.payload);
  const names = (message.labelIds ?? []).map((id) => label_names.get(id) ?? id);
  const body = include_bodies ? extract_message_body(message.payload) : '';

  return {
    id: message.id,
    thread_id: message.threadId,
    headers,
    snippet: message.snippet ?? '',
    from_name: from.name,
    from_address: from.address,
    to: headers.to ?? null,
    date: time?.iso ?? null,
    label_names: names,
    has_attachments: attachments.length > 0,
    attachments,
    ...(include_bodies
      ? {
          body_text: body,
          rendered_text: render_email({
            headers,
            time,
            label_names: names,
            attachments,
            body,
          }),
        }
      : {}),
  };
}

async function read_label_names(context: ConnectorNodeContext): Promise<LabelNames> {
  try {
    const response = await context.send_request<GmailLabelsList>({
      method: 'GET',
      path: '/users/me/labels',
      response_schema: labels_list_schema,
    });
    return new Map(
      (response.labels ?? [])
        .filter((label) => Boolean(label.name))
        .map((label) => [label.id, label.name as string]),
    );
  } catch (error) {
    context.log.warn('Gmail labels.list failed; messages keep their raw label ids', {
      connection_id: context.connection.connection_id,
      error: format_error_message(error),
    });
    return new Map();
  }
}

function build_list_path(label_ids: readonly string[] | undefined) {
  if (!label_ids || label_ids.length === 0) return '/users/me/messages';
  const repeated = new URLSearchParams(label_ids.map((label_id) => ['labelIds', label_id]));
  return `/users/me/messages?${repeated.toString()}`;
}

async function read_messages_by_id(
  message_ids: readonly string[],
  include_bodies: boolean,
  label_names: LabelNames,
  context: ConnectorNodeContext,
): Promise<MessageRow[]> {
  const results = await context.fan_out({
    items: message_ids,
    limits: context.app.rate_limits,
    call_one: (message_id: string) =>
      context.send_request<GmailMessage>({
        method: 'GET',
        path: `/users/me/messages/${encodeURIComponent(message_id)}`,
        query: { format: include_bodies ? 'full' : 'metadata' },
        response_schema: message_schema,
      }),
  });

  const rows: MessageRow[] = [];
  for (const result of results) {
    if (!result.ok) {
      throw new ConnectorHttpError(
        result.error.code,
        `Gmail could not read message ${message_ids[result.index]}: ${result.error.message}`,
        null,
        result.error.retryable,
      );
    }
    rows.push(build_message_row(result.data, include_bodies, label_names));
  }
  return rows;
}

async function list_message_ids(input: ListMessagesInput, context: ConnectorNodeContext) {
  const page = await context.send_request<ListMessagesPage>({
    method: 'GET',
    path: build_list_path(input.label_ids),
    query: { maxResults: messages_page_size, q: input.query, pageToken: input.cursor },
    response_schema: list_messages_schema,
  });
  return {
    ids: (page.messages ?? []).map((message) => message.id),
    next_cursor: page.nextPageToken ?? null,
  };
}

export async function execute(
  input: ListMessagesInput,
  context: ConnectorNodeContext,
): Promise<ListMessagesOutput> {
  const include_bodies = input.include_bodies ?? false;

  if (input.message_ids && input.message_ids.length > 0) {
    const label_names = await read_label_names(context);
    return {
      messages: await read_messages_by_id(input.message_ids, include_bodies, label_names, context),
      next_cursor: null,
    };
  }

  const { ids, next_cursor } = await list_message_ids(input, context);
  if (ids.length === 0) return { messages: [], next_cursor };
  const label_names = await read_label_names(context);
  return {
    messages: await read_messages_by_id(ids, include_bodies, label_names, context),
    next_cursor,
  };
}
