import { type EmailTag, resend_request } from '@runtime-platform/channels/email/resend_api';
import { z } from 'zod';

const sent_email_page_schema = z
  .object({
    data: z.array(z.object({ id: z.string().min(1), created_at: z.string() }).passthrough()),
    has_more: z.boolean().optional(),
  })
  .passthrough();

const sent_email_tags_schema = z
  .object({ tags: z.array(z.object({ name: z.string(), value: z.string() })).nullish() })
  .passthrough();

const sent_email_lookup_page_limit = 5;

export type SentEmailLookup =
  | { status: 'found'; email_id: string }
  | { status: 'not_found' }
  | { status: 'unknown'; reason: string };

type SentEmailSearch = {
  tag: EmailTag;
  sent_after: Date;
  page: number;
  after: string | undefined;
};

export async function find_sent_email_by_tag(input: {
  tag: EmailTag;
  sent_after: Date;
}): Promise<SentEmailLookup> {
  return search_sent_email_page({ ...input, page: 0, after: undefined });
}

async function search_sent_email_page(search: SentEmailSearch): Promise<SentEmailLookup> {
  if (search.page >= sent_email_lookup_page_limit) {
    return { status: 'unknown', reason: 'too_many_sent_emails_to_check' };
  }
  const query = new URLSearchParams({
    limit: '100',
    ...(search.after ? { after: search.after } : {}),
  });
  const listed = sent_email_page_schema.parse(
    await resend_request(`/emails?${query.toString()}`, { method: 'GET' }),
  );
  const in_window = listed.data.filter(
    (email) => new Date(email.created_at).getTime() >= search.sent_after.getTime(),
  );
  const found = await find_email_with_tag(
    in_window.map((email) => email.id),
    search.tag,
  );
  if (found) return { status: 'found', email_id: found };
  const reached_window_start = in_window.length < listed.data.length;
  if (reached_window_start || !listed.has_more) return { status: 'not_found' };
  return search_sent_email_page({
    ...search,
    page: search.page + 1,
    after: listed.data.at(-1)?.id,
  });
}

async function find_email_with_tag(email_ids: string[], tag: EmailTag): Promise<string | null> {
  const [email_id, ...remaining_ids] = email_ids;
  if (email_id === undefined) return null;
  const email = sent_email_tags_schema.parse(
    await resend_request(`/emails/${encodeURIComponent(email_id)}`, { method: 'GET' }),
  );
  if (email.tags?.some((each) => each.name === tag.name && each.value === tag.value)) {
    return email_id;
  }
  return find_email_with_tag(remaining_ids, tag);
}
