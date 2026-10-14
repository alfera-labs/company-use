import { create_logger, format_error_message, ValidationError } from '@coworker/shared';
import {
  create_runtime_attachment_source_map,
  type RuntimeAttachmentSource,
} from '@runtime-platform/attachments/runtime_attachment_source';
import {
  list_received_email_attachments,
  type ReceivedEmailAttachment,
} from '@runtime-platform/channels/email/resend_api';

// Turns an inbound email's attachments into request-only byte sources, so a forwarded PDF or a
// pasted spreadsheet reaches the sandbox the same way a Slack upload or a chat upload does.
// The webhook carries only names and sizes; the bytes come from a signed URL fetched here, and
// that URL expires in an hour — so it is resolved at open time, never stored on the message.

const log = create_logger('email_attachment_sources');

export async function create_email_attachment_sources(
  email_id: string,
  attachments: ReceivedEmailAttachment[] | undefined,
): Promise<RuntimeAttachmentSource[]> {
  if (!attachments?.length) return [];

  const sources = attachments.map((attachment) =>
    create_email_attachment_source(email_id, attachment),
  );
  create_runtime_attachment_source_map(sources);
  return sources;
}

export async function read_email_attachments(email_id: string): Promise<ReceivedEmailAttachment[]> {
  try {
    return await list_received_email_attachments(email_id);
  } catch (error) {
    log.warn('listing inbound email attachments failed; continuing without them', {
      email_id,
      error: format_error_message(error),
    });
    return [];
  }
}

function create_email_attachment_source(
  email_id: string,
  attachment: ReceivedEmailAttachment,
): RuntimeAttachmentSource {
  const source: RuntimeAttachmentSource = {
    attachment_id: `email:${email_id}:${attachment.id}`,
    file_name: attachment.filename ?? `attachment-${attachment.id}`,
    mime_type: attachment.content_type ?? 'application/octet-stream',
    byte_size: attachment.size ?? 0,
    open_bytes: async () => {
      const download = await open_email_attachment_bytes(attachment);
      source.byte_size = download.byte_size;
      return download.stream;
    },
  };
  return source;
}

async function open_email_attachment_bytes(attachment: ReceivedEmailAttachment) {
  const url = validate_email_attachment_url(attachment.download_url);
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) {
    throw new ValidationError(`Email attachment download failed with status ${response.status}`);
  }
  const content_length = read_content_length(response);
  return {
    stream: response.body,
    byte_size: content_length ?? attachment.size ?? 0,
  };
}

// The download URL is signed and provider-issued, so it carries no credential of ours — but it
// still decides where the runtime sends a request, so it stays pinned to Resend's inbound CDN.
// resend.app is the one that matters in practice: live downloads come from
// cdn.resend.app, even though the API reference documents inbound-cdn.resend.com. Both stay
// listed so a provider-side change back does not silently break attachments again.
const resend_owned_domains = ['resend.com', 'resend.app', 'resend.dev'];

export function validate_email_attachment_url(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const resend_host = resend_owned_domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (url.protocol !== 'https:' || !resend_host) {
    throw new ValidationError('Email attachment URL must use a Resend-owned HTTPS host');
  }
  return url;
}

function read_content_length(response: Response) {
  if (response.headers.has('content-encoding')) return null;
  const value = response.headers.get('content-length');
  if (value === null) return null;
  const byte_size = Number(value);
  return Number.isSafeInteger(byte_size) && byte_size >= 0 ? byte_size : null;
}
