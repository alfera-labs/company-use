import { AppError } from '@coworker/shared';
import { get_composio_client } from '@runtime-platform/composio/composio_client';
import { z } from 'zod';

export type ComposioAccount = { connected_account_id: string; user_id: string };

const webhook_answer_schema = z.object({
  id: z.object({ webhook_id: z.string() }).passthrough(),
  // Shown once, on create, and never again. Whoever calls this must store it.
  secret: z.string(),
});

const object_answer_schema = z.object({
  id: z.object({ object_id: z.string() }).passthrough(),
});

// Composio hands back Attio's answer as the action's `data`. Some Attio actions keep Attio's own
// `{ data: ... }` envelope inside it and some do not, so both are read.
function read_attio_answer<T>(schema: z.ZodType<T>, data: unknown): T {
  const inner = z.object({ data: z.unknown() }).safeParse(data);
  const unwrapped = schema.safeParse(inner.success ? inner.data.data : undefined);
  return unwrapped.success ? unwrapped.data : schema.parse(data);
}

// A webhook that is already gone reads as 404, which the trigger lifecycle treats as "done".
// Composio passes Attio's refusal on as text, so the text is the only place the status lives.
function attio_error_status(reason: string): 404 | 502 {
  return /\b404\b|not[ _]found/iu.test(reason) ? 404 : 502;
}

async function run_attio_action(
  account: ComposioAccount,
  tool_slug: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await get_composio_client().execute_tool(tool_slug, {
    connected_account_id: account.connected_account_id,
    user_id: account.user_id,
    arguments: args,
    version: 'latest',
  });
  if (!result.successful) {
    const reason = result.error ?? 'no reason given';
    throw new AppError(
      'attio_request_failed',
      `Attio refused ${tool_slug} through Composio: ${reason}`,
      attio_error_status(reason),
    );
  }
  return result.data;
}

// The object id behind a slug. Attio's subscription filter and its deliveries compare ids only, so
// "companies" has to become an id before it can narrow anything.
export async function read_attio_object_id(account: ComposioAccount, object: string) {
  const data = await run_attio_action(account, 'ATTIO_GET_OBJECT', { object });
  return read_attio_answer(object_answer_schema, data).id.object_id;
}

export async function create_attio_webhook(
  account: ComposioAccount,
  input: { target_url: string; event_type: string },
): Promise<{ webhook_id: string; secret: string }> {
  const data = await run_attio_action(account, 'ATTIO_CREATE_WEBHOOK', {
    target_url: input.target_url,
    subscriptions: [
      {
        event_type: input.event_type,
        // No subscription filter. A `parent_object_id` equals-filter registers and then
        // delivers nothing. The object is filtered where the delivery lands, on `attio_object_id`.
        filter: null,
      },
    ],
  });
  const created = read_attio_answer(webhook_answer_schema, data);
  return { webhook_id: created.id.webhook_id, secret: created.secret };
}

export async function delete_attio_webhook(account: ComposioAccount, webhook_id: string) {
  await run_attio_action(account, 'ATTIO_DELETE_WEBHOOK', { webhook_id });
}
