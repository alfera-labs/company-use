import type { Database } from '@coworker/core/db/connection';
import { list_model_provider_accounts } from '@coworker/core/db/queries/model_provider_accounts';
import { workspaces } from '@coworker/core/db/schema';
import { NotFoundError } from '@coworker/shared';
import { eq, sql } from 'drizzle-orm';

const model_billing_key = 'model_billing';

export type ModelBillingSource = 'own_account' | 'credits';

export async function read_model_billing_preference(
  db: Database,
  workspace_id: string,
): Promise<ModelBillingSource> {
  const row = await db.query.workspaces.findFirst({
    columns: { workspace_data: true },
    where: eq(workspaces.workspace_id, workspace_id),
  });
  const source = (row?.workspace_data as { model_billing?: { source?: string } } | null)
    ?.model_billing?.source;
  return source === 'credits' ? 'credits' : 'own_account';
}

export async function read_model_billing(db: Database, workspace_id: string) {
  const [billing_preference, accounts] = await Promise.all([
    read_model_billing_preference(db, workspace_id),
    list_model_provider_accounts(db, workspace_id),
  ]);
  const has_working_account = accounts.some((account) => account.credential_status === 'active');
  const billing_source: ModelBillingSource =
    billing_preference === 'own_account' && has_working_account ? 'own_account' : 'credits';
  return { accounts, billing_preference, billing_source };
}

export async function write_model_billing_preference(
  db: Database,
  input: { workspace_id: string; source: ModelBillingSource; actor_id: string },
): Promise<void> {
  const model_billing = { source: input.source };
  const rows = await db
    .update(workspaces)
    .set({
      workspace_data: sql`${workspaces.workspace_data} || jsonb_build_object(${model_billing_key}::text, ${JSON.stringify(model_billing)}::jsonb)`,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(workspaces.workspace_id, input.workspace_id))
    .returning({ workspace_id: workspaces.workspace_id });

  if (rows.length === 0) throw new NotFoundError('Workspace not found');
}
