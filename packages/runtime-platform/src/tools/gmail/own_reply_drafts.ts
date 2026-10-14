import {
  find_gmail_header,
  type GmailTransport,
  gmail_message_schema,
  parse_gmail_response,
} from '@runtime-platform/tools/gmail/gmail_api';
import { z } from 'zod';

export const own_draft_boundary_prefix = 'alfera_';

const thread_schema = z.object({
  messages: z
    .array(gmail_message_schema.extend({ labelIds: z.array(z.string()).optional() }))
    .optional(),
});

const draft_list_schema = z.object({
  drafts: z.array(z.object({ id: z.string(), message: z.object({ id: z.string() }) })).optional(),
});

/**
 * Drafts this tool wrote earlier in the thread that nobody has edited since. A mail client that
 * saves a draft rewrites its MIME boundary, so a draft a person touched no longer matches.
 */
export async function list_own_untouched_drafts(transport: GmailTransport, thread_id: string) {
  const thread = parse_gmail_response(
    thread_schema,
    await transport.get_json(
      `/threads/${encodeURIComponent(thread_id)}?format=metadata&metadataHeaders=Content-Type`,
    ),
    'thread',
  );
  const own_message_ids = new Set(
    (thread.messages ?? [])
      .filter(
        (message) =>
          message.labelIds?.includes('DRAFT') &&
          find_gmail_header(message.payload, 'Content-Type').includes(
            `boundary="${own_draft_boundary_prefix}`,
          ),
      )
      .map((message) => message.id),
  );
  if (own_message_ids.size === 0) return [];
  const listed = parse_gmail_response(
    draft_list_schema,
    await transport.get_json('/drafts?maxResults=500&includeSpamTrash=true'),
    'draft list',
  );
  return (listed.drafts ?? [])
    .filter((draft) => own_message_ids.has(draft.message.id))
    .map((draft) => draft.id);
}

/** Deletes each draft on its own, so one refusal leaves the others deleted and is reported. */
export async function delete_drafts(transport: GmailTransport, draft_ids: string[]) {
  const outcomes = await Promise.allSettled(draft_ids.map((id) => transport.delete_draft(id)));
  const kept = draft_ids.filter((_id, index) => outcomes[index]?.status === 'rejected');
  return {
    replaced_draft_ids: draft_ids.filter((id) => !kept.includes(id)),
    ...(kept.length > 0 ? { earlier_drafts_not_removed: kept } : {}),
  };
}
