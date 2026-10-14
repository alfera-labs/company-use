import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { get_automation, list_automations } from '@coworker/core/db/queries/automation_reads';
import {
  count_runs_by_automation,
  list_automation_run_page,
} from '@coworker/core/db/queries/automation_runs';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import {
  archive_automation,
  create_automation,
  update_automation,
} from '@coworker/core/db/queries/automation_writes';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { runs, triggers } from '@coworker/core/db/schema';
import { create_id, id_prefixes } from '@coworker/shared';
import { describe, expect, it } from 'vitest';

describe('automations', () => {
  it('bumps the instruction version only when the wording changes', async () => {
    const fixture = await create_fixture();
    const automation = await create_fixture_automation(fixture);

    const renamed = await update_automation(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
      automation_name: 'Morning inbox',
      instruction: automation.instruction,
      actor_id: fixture.actor_id,
    });
    const rewritten = await update_automation(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
      instruction: 'Read the unread mail and draft replies to customers only.',
      actor_id: fixture.actor_id,
    });

    expect(renamed?.instruction_version).toBe(1);
    expect(renamed?.automation_name).toBe('Morning inbox');
    expect(rewritten?.instruction_version).toBe(2);
  });

  it('keeps archived automations out of the list but readable by id', async () => {
    const fixture = await create_fixture();
    const automation = await create_fixture_automation(fixture);
    const kept = await create_fixture_automation(fixture, 'Lost lead re-engagement');

    await archive_automation(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
      actor_id: fixture.actor_id,
    });
    const listed = await list_automations(fixture.db, { workspace_id: fixture.workspace_id });
    const archived_listed = await list_automations(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_statuses: ['archived'],
    });
    const read_by_id = await get_automation(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
    });

    expect(listed.map((row) => row.automation_id)).toEqual([kept.automation_id]);
    expect(archived_listed.map((row) => row.automation_id)).toEqual([automation.automation_id]);
    expect(read_by_id?.automation_status).toBe('archived');
  });

  it('reads its own triggers and its own run count', async () => {
    const fixture = await create_fixture();
    const automation = await create_fixture_automation(fixture);
    const other = await create_fixture_automation(fixture, 'Lost lead re-engagement');

    await add_trigger(fixture, automation.automation_id, 'Every weekday at 8:00');
    await add_trigger(fixture, automation.automation_id, 'When a customer emails');
    await add_trigger(fixture, other.automation_id, 'Every two weeks');
    await add_run(fixture, automation.automation_id);
    await add_run(fixture, automation.automation_id);
    await add_run(fixture, other.automation_id);

    const trigger_names = await list_automation_triggers(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
    });
    const counts = await count_runs_by_automation(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_ids: [automation.automation_id, other.automation_id],
    });

    expect(trigger_names.map((row) => row.trigger_name)).toEqual([
      'Every weekday at 8:00',
      'When a customer emails',
    ]);
    expect(Object.fromEntries(counts.map((row) => [row.automation_id, row.run_count]))).toEqual({
      [automation.automation_id]: 2,
      [other.automation_id]: 1,
    });
    expect(counts.every((row) => row.last_run_time !== null)).toBe(true);
  });

  it('pages the runs of this automation, newest first, numbered from the whole history', async () => {
    const fixture = await create_fixture();
    const automation = await create_fixture_automation(fixture);
    const other = await create_fixture_automation(fixture, 'Lost lead re-engagement');
    await add_run(fixture, automation.automation_id);
    await add_run(fixture, automation.automation_id);
    await add_run(fixture, automation.automation_id);
    await add_run(fixture, other.automation_id);

    const first_page = await list_automation_run_page(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
      page: 1,
      page_size: 2,
      reader_id: fixture.actor_id,
    });
    const second_page = await list_automation_run_page(fixture.db, {
      workspace_id: fixture.workspace_id,
      automation_id: automation.automation_id,
      page: 2,
      page_size: 2,
      reader_id: fixture.actor_id,
    });

    expect(first_page.total_count).toBe(3);
    expect(first_page.items.map((item) => item.run_number)).toEqual([3, 2]);
    expect(second_page.items.map((item) => item.run_number)).toEqual([1]);
    expect(first_page.items.every((item) => item.is_unread === false)).toBe(true);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return {
    db,
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

async function create_fixture_automation(
  fixture: Fixture,
  automation_name = 'Morning inbox sweep',
) {
  return create_automation(fixture.db, {
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    automation_name,
    instruction: 'Read my unread email and draft replies to anything from a customer.',
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    conditions: [{ field: 'from', operation: 'does_not_contain_any_of', values: ['no-reply'] }],
    judge: { question: 'Is this a customer inquiry?', run_at_or_above: 60 },
    actor_id: fixture.actor_id,
  });
}

async function add_trigger(fixture: Fixture, automation_id: string, trigger_name: string) {
  await fixture.db.insert(triggers).values({
    trigger_id: create_id(id_prefixes.trigger),
    workspace_id: fixture.workspace_id,
    agent_id: fixture.agent_id,
    automation_id,
    trigger_name,
    trigger_type: 'schedule',
    trigger_config: { starts_job_handler: 'run_automation' },
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}

async function add_run(fixture: Fixture, automation_id: string) {
  await fixture.db.insert(runs).values({
    run_id: create_id(id_prefixes.run),
    workspace_id: fixture.workspace_id,
    session_id: create_id(id_prefixes.session),
    agent_id: fixture.agent_id,
    automation_id,
    created_by: fixture.actor_id,
    last_updated_by: fixture.actor_id,
  });
}
