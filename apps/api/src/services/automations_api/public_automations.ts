import type { CreateAutomationInput } from '@api/services/automations/automation_input';
import {
  type AutomationWithTriggers,
  create_workspace_automation,
  delete_workspace_automation,
  get_workspace_automation,
  list_workspace_automations,
  read_workspace_automation,
} from '@api/services/automations/automation_service';
import { edit_workspace_automation } from '@api/services/automations/edit_automation';
import { run_workspace_automation_now } from '@api/services/automations/run_automation_now';
import type { Database } from '@coworker/core';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { list_automation_run_page } from '@coworker/core/db/queries/automation_runs';
import { find_agent_by_slug } from '@coworker/core/db/queries/sessions';
import {
  AppError,
  describe_automation_author,
  may_retire_automation,
  NotFoundError,
} from '@coworker/shared';
import { summarize_automation } from '@runtime-platform/tools/definitions/automations_support';

type CreateBody = Omit<CreateAutomationInput, 'workspace_id' | 'agent_id' | 'actor_id'> & {
  agent?: string | undefined;
};
type EditBody = Parameters<typeof edit_workspace_automation>[1];

const default_agent_slug = 'main';

function public_automation(api_key: ApiKey, { automation, triggers }: AutomationWithTriggers) {
  const summary = summarize_automation(automation, triggers);
  if (api_key.scopes.includes('automations.write')) return summary;
  return {
    ...summary,
    triggers: summary.triggers.map(({ webhook_secret: _secret, ...trigger }) => trigger),
  };
}

export async function create_api_automation(db: Database, api_key: ApiKey, body: CreateBody) {
  const { agent, ...fields } = body;
  const found = await find_agent_by_slug(db, api_key.workspace_id, agent ?? default_agent_slug);
  if (!found) throw new NotFoundError('Agent');
  const created = await create_workspace_automation(db, {
    ...fields,
    workspace_id: api_key.workspace_id,
    agent_id: found.agent_id,
    actor_id: api_key.api_key_id,
    created_via: 'api',
  });
  return public_automation(api_key, created);
}

export async function list_api_automations(db: Database, api_key: ApiKey) {
  const rows = await list_workspace_automations(db, api_key.workspace_id);
  return rows.map((row) => public_automation(api_key, { automation: row, triggers: row.triggers }));
}

export async function get_api_automation(db: Database, api_key: ApiKey, automation_id: string) {
  const read = await get_workspace_automation(db, {
    workspace_id: api_key.workspace_id,
    automation_id,
  });
  return public_automation(api_key, read);
}

export async function edit_api_automation(
  db: Database,
  api_key: ApiKey,
  automation_id: string,
  body: Omit<EditBody, 'workspace_id' | 'automation_id' | 'actor_id'>,
) {
  const edited = await edit_workspace_automation(db, {
    ...body,
    workspace_id: api_key.workspace_id,
    automation_id,
    actor_id: api_key.api_key_id,
  });
  return public_automation(api_key, edited);
}

async function refuse_deleting_somebody_elses_automation(
  db: Database,
  api_key: ApiKey,
  automation_id: string,
) {
  const automation = await read_workspace_automation(db, {
    workspace_id: api_key.workspace_id,
    automation_id,
  });
  if (may_retire_automation(automation, api_key.api_key_id)) return;
  throw new AppError(
    'ask_the_person',
    `"${automation.automation_name}" was set up by ${describe_automation_author(automation)}, and an API key may only delete automations it created itself. Ask a workspace member to delete it from the dashboard, or stop it with PATCH /v1/automations/${automation_id} {"automation_status": "paused"}.`,
    403,
  );
}

export async function delete_api_automation(db: Database, api_key: ApiKey, automation_id: string) {
  await refuse_deleting_somebody_elses_automation(db, api_key, automation_id);
  const deleted = await delete_workspace_automation(db, {
    workspace_id: api_key.workspace_id,
    automation_id,
    actor_id: api_key.api_key_id,
  });
  return {
    automation_id: deleted.automation.automation_id,
    deleted: true,
    triggers: deleted.triggers,
  };
}

export async function trigger_api_automation(
  db: Database,
  api_key: ApiKey,
  input: { automation_id: string; idempotency_key: string | undefined },
) {
  const fired = await run_workspace_automation_now(db, {
    workspace_id: api_key.workspace_id,
    automation_id: input.automation_id,
    occurrence_key: input.idempotency_key
      ? `${api_key.api_key_id}:${input.idempotency_key}`
      : crypto.randomUUID(),
    actor_id: api_key.api_key_id,
  });
  return {
    automation_id: input.automation_id,
    trigger_id: fired.trigger_id,
    event_id: fired.event_id,
    started: fired.fired,
  };
}

export async function list_api_automation_runs(
  db: Database,
  api_key: ApiKey,
  input: { automation_id: string; page: number; page_size: number },
) {
  await read_workspace_automation(db, {
    workspace_id: api_key.workspace_id,
    automation_id: input.automation_id,
  });
  const page = await list_automation_run_page(db, {
    ...input,
    workspace_id: api_key.workspace_id,
    reader_id: api_key.api_key_id,
  });
  const has_more = page.page * page.page_size < page.total_count;
  return {
    data: page.items.map((run) => ({
      run_id: run.run_id,
      session_id: run.session_id,
      status: run.run_status,
      error_message: run.error_message,
      created_time: run.created_time,
      started_time: run.started_time,
      finished_time: run.finished_time,
    })),
    next_page: has_more ? String(page.page + 1) : null,
    prev_page: page.page > 1 ? String(page.page - 1) : null,
  };
}
