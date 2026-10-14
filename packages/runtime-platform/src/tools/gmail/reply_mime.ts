import { AppError } from '@coworker/shared';

export type ReplyAttachment = { file_name: string; mime_type: string; bytes: Uint8Array };

export type RepliedMessage = {
  message_id: string;
  references: string;
  thread_id: string;
  reply_to_header: string;
  from_header: string;
};

export type ReplyMimeInput = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  body_type: 'html' | 'plaintext';
  replied_message: RepliedMessage;
  attachments: ReplyAttachment[];
  boundary: string;
};

const email_address_pattern = /[^\s<>,;"']+@[^\s<>,;"']+/gu;
const plain_header_text = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/u;

/**
 * Builds the raw RFC 5322 reply. The subject is exactly the caller's; In-Reply-To and References
 * point at the replied message, which is what makes Gmail file the draft as a reply in its thread.
 */
export function build_reply_mime(input: ReplyMimeInput): Buffer {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
    ...optional_header('Cc', input.cc.join(', ')),
    ...optional_header('Bcc', input.bcc.join(', ')),
    `Subject: ${encode_header_text(input.subject)}`,
    ...optional_header('In-Reply-To', input.replied_message.message_id),
    ...optional_header('References', list_references(input.replied_message)),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${input.boundary}"`,
  ];
  const body_part = [
    `--${input.boundary}`,
    `Content-Type: ${input.body_type === 'html' ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap_base64(Buffer.from(input.body, 'utf8')),
  ];
  const file_parts = input.attachments.flatMap((file) => [
    `--${input.boundary}`,
    `Content-Type: ${file.mime_type}; name="${encode_header_text(file.file_name)}"`,
    `Content-Disposition: attachment; filename="${encode_header_text(file.file_name)}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap_base64(file.bytes),
  ]);
  const lines = [...headers, '', ...body_part, ...file_parts, `--${input.boundary}--`, ''];
  return Buffer.from(lines.join('\r\n'), 'ascii');
}

/** Without an explicit `to`, a reply goes where the original asked: Reply-To, else From. */
export function list_reply_recipients(to: string[], replied_message: RepliedMessage) {
  if (to.length > 0) return to;
  const reply_header = replied_message.reply_to_header || replied_message.from_header;
  const addresses = [...new Set(reply_header.match(email_address_pattern) ?? [])];
  if (addresses.length === 0) {
    throw new AppError(
      'reply_recipient_missing',
      'The original message has no Reply-To or From address. Pass `to` explicitly.',
      422,
    );
  }
  return addresses;
}

/** RFC 2047: text with an emoji, an accent, a quote, or a line break travels as base64 UTF-8. */
export function encode_header_text(value: string) {
  // One unfolded encoded word, which Gmail decodes at any length. Fold at 75 characters if these bytes ever go to a stricter mail system.
  if (plain_header_text.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function list_references(replied_message: RepliedMessage) {
  return [replied_message.references, replied_message.message_id].filter(Boolean).join(' ');
}

function optional_header(name: string, value: string) {
  return value ? [`${name}: ${value}`] : [];
}

function wrap_base64(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString('base64');
  const lines: string[] = [];
  for (let start = 0; start < text.length; start += 76) lines.push(text.slice(start, start + 76));
  return lines.join('\r\n');
}
