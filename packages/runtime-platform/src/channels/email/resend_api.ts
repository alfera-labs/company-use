import { AppError } from '@coworker/shared';
import { normalize_email_headers } from '@runtime-platform/channels/email/received_email_headers';
import { z } from 'zod';

// The one owner of the Resend HTTP boundary for the email channel: fetching a received email's
// full content and sending a threaded reply. The installed resend SDK (4.x) has no receiving
// endpoints, so both calls speak the REST API directly; Resend types stop at this file.

const resend_api_base_url = 'https://api.resend.com';

const received_email_schema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.array(z.string()).default([]),
    cc: z.array(z.string()).nullish(),
    reply_to: z.array(z.string()).nullish(),
    subject: z.string().nullish(),
    text: z.string().nullish(),
    html: z.string().nullish(),
    message_id: z.string().nullish(),
    authentication: z
      .object({
        spf: z.string().nullish(),
        dkim: z.string().nullish(),
        dmarc: z.string().nullish(),
      })
      .nullish(),
    headers: z
      .union([
        z.record(z.string(), z.unknown()),
        z.array(z.object({ name: z.string(), value: z.unknown() }).passthrough()),
      ])
      .nullish()
      .transform((headers) => normalize_email_headers(headers)),
    attachments: z
      .array(
        z
          .object({
            id: z.string(),
            filename: z.string().nullish(),
            content_type: z.string().nullish(),
            size: z.number().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

export type ReceivedEmail = z.infer<typeof received_email_schema>;

export async function fetch_received_email(email_id: string): Promise<ReceivedEmail> {
  const response = await resend_request(`/emails/receiving/${encodeURIComponent(email_id)}`, {
    method: 'GET',
  });
  return received_email_schema.parse(response);
}

const received_attachment_schema = z
  .object({
    id: z.string().min(1),
    filename: z.string().nullish(),
    content_type: z.string().nullish(),
    size: z.number().nullish(),
    download_url: z.string().min(1),
    expires_at: z.string().nullish(),
  })
  .passthrough();

const received_attachment_list_schema = z
  .object({ data: z.array(received_attachment_schema).default([]) })
  .passthrough();

export type ReceivedEmailAttachment = z.infer<typeof received_attachment_schema>;

export async function list_received_email_attachments(
  email_id: string,
): Promise<ReceivedEmailAttachment[]> {
  const response = await resend_request(
    `/emails/receiving/${encodeURIComponent(email_id)}/attachments`,
    { method: 'GET' },
  );
  return received_attachment_list_schema.parse(response).data;
}

export type SendEmailAttachment = {
  filename: string;
  content: string;
  content_type?: string;
};

export type SendEmailReplyInput = {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  in_reply_to?: string;
  references?: string[];
  attachments?: SendEmailAttachment[];
  idempotency_key?: string;
  tags?: EmailTag[];
};

export type EmailTag = { name: string; value: string };

export async function send_email_reply(input: SendEmailReplyInput): Promise<{ id: string }> {
  const headers = {
    ...(input.in_reply_to ? { 'In-Reply-To': input.in_reply_to } : {}),
    ...(input.references?.length ? { References: input.references.join(' ') } : {}),
  };
  const response = await resend_request('/emails', {
    method: 'POST',
    ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      ...(input.cc?.length ? { cc: input.cc } : {}),
      subject: input.subject.replace(/[\r\n]+/g, ' '),
      text: input.text,
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              ...(attachment.content_type ? { content_type: attachment.content_type } : {}),
            })),
          }
        : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
    }),
  });
  return z
    .object({ id: z.string().min(1) })
    .passthrough()
    .parse(response);
}

export async function fetch_sent_email_message_id(email_id: string): Promise<string | null> {
  try {
    const response = await resend_request(`/emails/${encodeURIComponent(email_id)}`, {
      method: 'GET',
    });
    const parsed = z
      .object({ message_id: z.string().min(1).nullish() })
      .passthrough()
      .safeParse(response);
    return parsed.success ? (parsed.data.message_id ?? null) : null;
  } catch {
    return null;
  }
}

export async function resend_request(
  path: string,
  init: { method: string; body?: string; idempotency_key?: string },
) {
  const api_key = process.env.RESEND_API_KEY;
  if (!api_key) {
    throw new AppError(
      'resend_api_key_missing',
      'RESEND_API_KEY is not set, so the email channel cannot reach Resend.',
      500,
    );
  }

  const response = await fetch(`${resend_api_base_url}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${api_key}`,
      'Content-Type': 'application/json',
      ...(init.idempotency_key ? { 'Idempotency-Key': init.idempotency_key } : {}),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body_text = await response.text().catch(() => '');
    throw new AppError(
      'resend_request_failed',
      `Resend ${init.method} ${path} failed with ${response.status}: ${body_text.slice(0, 500)}`,
      502,
    );
  }
  return (await response.json()) as unknown;
}
