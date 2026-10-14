import { randomUUID } from 'node:crypto';
import { AppError } from '@coworker/shared';
import {
  find_gmail_header,
  type GmailTransport,
  gmail_draft_created_schema,
  gmail_draft_schema,
  gmail_message_schema,
  gmail_profile_schema,
  list_attached_files,
  parse_gmail_response,
} from '@runtime-platform/tools/gmail/gmail_api';
import {
  delete_drafts,
  list_own_untouched_drafts,
  own_draft_boundary_prefix,
} from '@runtime-platform/tools/gmail/own_reply_drafts';
import {
  build_reply_mime,
  list_reply_recipients,
  type RepliedMessage,
  type ReplyAttachment,
} from '@runtime-platform/tools/gmail/reply_mime';

export type ReplyDraftRequest = {
  reply_to_message_id: string;
  subject: string;
  body: string;
  body_type: 'html' | 'plaintext';
  to: string[];
  cc: string[];
  bcc: string[];
  attachments: ReplyAttachment[];
};

const replied_header_names = ['Message-ID', 'References', 'Reply-To', 'From'];

/**
 * Creates the reply draft, then reads it back from Gmail. A draft whose stored subject, reply
 * header, or attachment count differs from the request is reported as a failure and left in
 * Drafts for a person to look at. A thread keeps one reply draft: once the new draft is verified,
 * the untouched drafts this tool wrote earlier in the same thread are deleted.
 */
export async function create_reply_draft(transport: GmailTransport, request: ReplyDraftRequest) {
  const [replied_message, own_address] = await Promise.all([
    get_replied_message(transport, request.reply_to_message_id),
    get_own_address(transport),
  ]);
  const mime = build_reply_mime({
    ...request,
    from: own_address,
    to: list_reply_recipients(request.to, replied_message),
    replied_message,
    boundary: `${own_draft_boundary_prefix}${randomUUID()}`,
  });
  const earlier_draft_ids = await list_own_untouched_drafts(transport, replied_message.thread_id);
  const created = parse_gmail_response(
    gmail_draft_created_schema,
    await transport.create_draft({ mime, thread_id: replied_message.thread_id }),
    'created draft',
  );
  const draft = await get_verified_draft(transport, created.id, {
    subject: request.subject,
    in_reply_to: replied_message.message_id,
    thread_id: replied_message.thread_id,
    attachment_count: request.attachments.length,
  });
  return { ...draft, ...(await delete_drafts(transport, earlier_draft_ids)) };
}

async function get_verified_draft(
  transport: GmailTransport,
  draft_id: string,
  expected: { subject: string; in_reply_to: string; thread_id: string; attachment_count: number },
) {
  const stored = parse_gmail_response(
    gmail_draft_schema,
    await transport.get_json(`/drafts/${encodeURIComponent(draft_id)}?format=full`),
    'draft read-back',
  );
  const stored_files = list_attached_files(stored.message.payload);
  const differences = list_draft_differences(stored.message.payload, stored_files.length, expected);
  if (differences.length > 0) {
    throw new AppError(
      'draft_verification_failed',
      `Draft ${draft_id} was created, but Gmail stored it differently: ${differences.join('; ')}. It is left in Drafts for a person to check.`,
      502,
      { draft_id },
    );
  }
  return {
    draft_id,
    message_id: stored.message.id,
    thread_id: stored.message.threadId,
    same_thread: stored.message.threadId === expected.thread_id,
    subject: find_gmail_header(stored.message.payload, 'Subject'),
    attachments: stored_files.map((file) => ({
      name: file.filename ?? '',
      bytes: file.body?.size ?? 0,
    })),
  };
}

async function get_replied_message(
  transport: GmailTransport,
  message_id: string,
): Promise<RepliedMessage> {
  const header_query = replied_header_names
    .map((name) => `&metadataHeaders=${encodeURIComponent(name)}`)
    .join('');
  const message = parse_gmail_response(
    gmail_message_schema,
    await transport.get_json(
      `/messages/${encodeURIComponent(message_id)}?format=metadata${header_query}`,
    ),
    'message',
  );
  return {
    message_id: find_gmail_header(message.payload, 'Message-ID'),
    references: find_gmail_header(message.payload, 'References'),
    thread_id: message.threadId,
    reply_to_header: find_gmail_header(message.payload, 'Reply-To'),
    from_header: find_gmail_header(message.payload, 'From'),
  };
}

async function get_own_address(transport: GmailTransport) {
  const profile = parse_gmail_response(
    gmail_profile_schema,
    await transport.get_json('/profile'),
    'profile',
  );
  return profile.emailAddress;
}

function list_draft_differences(
  stored_payload: Parameters<typeof find_gmail_header>[0],
  stored_attachment_count: number,
  expected: { subject: string; in_reply_to: string; attachment_count: number },
) {
  const stored_subject = find_gmail_header(stored_payload, 'Subject');
  const stored_in_reply_to = find_gmail_header(stored_payload, 'In-Reply-To');
  return [
    ...(stored_subject === expected.subject
      ? []
      : [`subject is "${stored_subject}" instead of "${expected.subject}"`]),
    ...(stored_in_reply_to === expected.in_reply_to
      ? []
      : [`In-Reply-To is "${stored_in_reply_to}" instead of "${expected.in_reply_to}"`]),
    ...(stored_attachment_count === expected.attachment_count
      ? []
      : [`${stored_attachment_count} attachments instead of ${expected.attachment_count}`]),
  ];
}
