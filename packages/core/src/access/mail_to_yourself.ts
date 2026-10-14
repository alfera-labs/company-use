import type { Database } from '@coworker/core/db/connection';
import { users, workspace_members } from '@coworker/core/db/schema';
import { and, eq } from 'drizzle-orm';

const recipient_field_pattern =
  /^(to|cc|bcc|recipients?|recipient_emails?|extra_recipients|to_emails?)$/iu;
const address_pattern = /[^\s"'<>,;:\\]+@[^\s"'<>,;:\\]+/gu;

export async function call_only_mails_the_workspace(
  db: Database,
  input: { workspace_id: string; tool_input: unknown },
): Promise<boolean> {
  const recipients = read_recipients(input.tool_input);
  if (recipients.length === 0) return false;
  const own = await list_active_member_addresses(db, input.workspace_id);
  return recipients.every((address) => own.has(address));
}

export function read_recipients(tool_input: unknown): string[] {
  const found: string[] = [];
  walk(tool_input, (key, value) => {
    if (!recipient_field_pattern.test(key)) return;
    for (const text of strings_in(value)) {
      for (const address of text.match(address_pattern) ?? []) found.push(normalise(address));
    }
  });
  return found;
}

function walk(value: unknown, visit: (key: string, value: unknown) => void) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    visit(key, child);
    walk(child, visit);
  }
}

function strings_in(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings_in);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings_in);
  return [];
}

function normalise(address: string) {
  return address.trim().toLowerCase();
}

async function list_active_member_addresses(db: Database, workspace_id: string) {
  const rows = await db
    .select({ email: users.email })
    .from(workspace_members)
    .innerJoin(
      users,
      and(eq(users.user_id, workspace_members.user_id), eq(users.user_status, 'active')),
    )
    .where(
      and(
        eq(workspace_members.workspace_id, workspace_id),
        eq(workspace_members.member_status, 'active'),
      ),
    );
  return new Set(rows.map((row) => normalise(row.email)));
}
