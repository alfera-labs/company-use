import { AppError } from '@coworker/shared';
import { z } from 'zod';

export const gmail_api_url = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type GmailMessagePart = {
  filename?: string | undefined;
  headers?: Array<{ name: string; value: string }> | undefined;
  body?: { size?: number | undefined } | undefined;
  parts?: GmailMessagePart[] | undefined;
};

const gmail_message_part_schema: z.ZodType<GmailMessagePart> = z.lazy(() =>
  z.object({
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ size: z.number().optional() }).optional(),
    parts: z.array(gmail_message_part_schema).optional(),
  }),
);

export const gmail_message_schema = z.object({
  id: z.string(),
  threadId: z.string(),
  payload: gmail_message_part_schema.optional(),
});

export const gmail_draft_schema = z.object({
  id: z.string(),
  message: gmail_message_schema,
});

export const gmail_draft_created_schema = z.object({
  id: z.string(),
  message: z.object({ id: z.string(), threadId: z.string() }),
});

export const gmail_profile_schema = z.object({ emailAddress: z.string().min(1) });

export type GmailMessage = z.infer<typeof gmail_message_schema>;

export function parse_gmail_response<Schema extends z.ZodType>(
  schema: Schema,
  response: unknown,
  what: string,
): z.infer<Schema> {
  const parsed = schema.safeParse(response);
  if (parsed.success) return parsed.data;
  throw new AppError(
    'gmail_response_unexpected',
    `Gmail returned an unexpected ${what}: ${JSON.stringify(response).slice(0, 300)}`,
    502,
  );
}

export function find_gmail_header(part: GmailMessagePart | undefined, name: string) {
  const wanted = name.toLowerCase();
  return part?.headers?.find((header) => header.name.toLowerCase() === wanted)?.value.trim() ?? '';
}

export function list_attached_files(part: GmailMessagePart | undefined): GmailMessagePart[] {
  if (!part) return [];
  const own = part.filename ? [part] : [];
  return [...own, ...(part.parts ?? []).flatMap(list_attached_files)];
}

/**
 * One Gmail account behind one provider. Only reads, draft creation and draft deletion exist
 * here: there is no send, so nothing built on it can send.
 */
export type GmailTransport = {
  provider: 'composio';
  get_json(path: string): Promise<unknown>;
  create_draft(input: { mime: Buffer; thread_id: string }): Promise<unknown>;
  delete_draft(draft_id: string): Promise<unknown>;
};
