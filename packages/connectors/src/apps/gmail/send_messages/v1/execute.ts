import node_definition from '@connectors/apps/gmail/send_messages/v1/node.json' with {
  type: 'json',
};
import type { ConnectorError, ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type OutgoingMessage = {
  to: string[];
  cc?: string[] | undefined;
  subject: string;
  body_text: string;
};

export type SendMessagesInput = { messages: OutgoingMessage[] };

type SendMessageResult =
  | { ok: true; index: number; id: string; thread_id: string }
  | { ok: false; index: number; error: ConnectorError };

export type SendMessagesOutput = { results: SendMessageResult[] };

type SentMessage = { id: string; threadId: string };

const sent_message_schema = node_definition.response_schema as JsonSchema;

const line_ending = '\r\n';
const printable_ascii = /^[ -~]*$/u;
const line_break = /[\r\n]/u;

function encode_header_value(value: string) {
  if (printable_ascii.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrap_base64_lines(encoded: string) {
  return (encoded.match(/.{1,76}/gu) ?? []).join(line_ending);
}

function check_header_fields(message: OutgoingMessage) {
  const header_fields = [...message.to, ...(message.cc ?? []), message.subject];
  const broken = header_fields.find((field) => line_break.test(field));
  if (broken !== undefined) {
    throw new Error(`Email header must not contain a line break: ${JSON.stringify(broken)}`);
  }
}

function build_rfc2822_message(message: OutgoingMessage) {
  check_header_fields(message);
  const headers = [
    `To: ${message.to.join(', ')}`,
    ...(message.cc && message.cc.length > 0 ? [`Cc: ${message.cc.join(', ')}`] : []),
    `Subject: ${encode_header_value(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const body = wrap_base64_lines(Buffer.from(message.body_text, 'utf8').toString('base64'));
  return `${headers.join(line_ending)}${line_ending}${line_ending}${body}${line_ending}`;
}

function build_gmail_raw_message(message: OutgoingMessage) {
  return Buffer.from(build_rfc2822_message(message), 'utf8').toString('base64url');
}

export async function execute(
  input: SendMessagesInput,
  context: ConnectorNodeContext,
): Promise<SendMessagesOutput> {
  for (const message of input.messages) check_header_fields(message);

  const results = await context.fan_out({
    items: input.messages,
    limits: context.app.rate_limits,
    call_one: (message: OutgoingMessage) =>
      context.send_request<SentMessage>({
        method: 'POST',
        path: '/users/me/messages/send',
        body: { raw: build_gmail_raw_message(message) },
        response_schema: sent_message_schema,
      }),
  });

  return {
    results: results.map((result) =>
      result.ok
        ? {
            ok: true as const,
            index: result.index,
            id: result.data.id,
            thread_id: result.data.threadId,
          }
        : { ok: false as const, index: result.index, error: result.error },
    ),
  };
}
