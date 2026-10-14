import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { list_automations } from '@coworker/core/db/queries/automation_reads';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { triggers } from '@coworker/core/db/schema';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const volume = new Map<string, string>();

vi.mock('@runtime-platform/files/workspace_volume_browser', () => ({
  resolve_workspace_volume_address: async () => ({
    volume_id: 'vol_1',
    provider_volume_id: 'pvol_1',
    region: undefined,
    volume_workspace_path: 'agents/agt_1/workspace',
    layout: { folders: [], reserved_write_aliases: [] },
  }),
  read_workspace_volume_file: async (_address: unknown, file_path: string) => {
    const text = volume.get(file_path);
    if (text === undefined) {
      const { AppError } = await import('@coworker/shared');
      throw new AppError('workspace_file_not_found', 'gone', 404);
    }
    return new TextEncoder().encode(text);
  },
  list_workspace_volume_folder: async () => ({
    folder_names: [],
    files: [...volume.keys()]
      .filter((file_path) => file_path.startsWith('goals/'))
      .map((file_path) => ({
        file_name: file_path.slice('goals/'.length),
        byte_size: 1,
        last_modified_time: null,
      })),
  }),
  write_workspace_volume_file: async (
    _address: unknown,
    input: { file_path: string; data: Uint8Array },
  ) => {
    volume.set(input.file_path, new TextDecoder().decode(input.data));
  },
  replace_workspace_volume_file: async (
    _address: unknown,
    input: { file_path: string; data: Uint8Array },
  ) => {
    volume.set(input.file_path, new TextDecoder().decode(input.data));
  },
}));

const { create_goal_tool, list_goals_tool, update_goal_tool } = await import(
  '@runtime-platform/tools/definitions/goals'
);

const goal_input = {
  name: 'Sub 4 hour marathon',
  objective: 'Run a marathon in under four hours',
  constraints: 'No running on travel weeks.',
  plan: 'Long run every Saturday.',
  review: 'weekly' as const,
};

async function create_runtime_context(): Promise<RuntimeToolExecutionContext> {
  const db = await create_test_database();
  const workspace = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_goal',
    organization_id: 'org_goal',
    email: 'goal@example.com',
    first_name: 'Goal',
    last_name: 'Setter',
  });
  return {
    db,
    workspace_id: workspace.workspace_id,
    session_id: 'ses_goal',
    run_id: 'run_goal',
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  };
}

function list_goal_automations(context: RuntimeToolExecutionContext) {
  return list_automations(context.db, {
    workspace_id: context.workspace_id,
    created_via: 'agent_tool',
  });
}

describe('starting a goal', () => {
  beforeEach(() => {
    volume.clear();
  });

  it('writes the goal file and the schedule that comes back to it', async () => {
    const context = await create_runtime_context();
    const result = await create_goal_tool.execute(goal_input, context);

    expect(result.success).toBe(true);
    const [automation] = await list_goal_automations(context);
    expect(automation?.automation_name).toBe('Goal: Sub 4 hour marathon');
    expect(automation?.instruction).toContain('goals/sub-4-hour-marathon.md');
    expect(automation?.instruction).toContain('notification');
    const ears = await context.db.query.triggers.findMany({
      where: eq(triggers.automation_id, automation?.automation_id ?? ''),
    });
    expect(ears.map((ear) => [ear.trigger_type, ear.schedule_expression])).toEqual([
      ['schedule', '0 9 * * 1'],
    ]);

    const file = volume.get('goals/sub-4-hour-marathon.md');
    expect(file).toContain('objective: Run a marathon in under four hours');
    expect(file).toContain('status: active');
    expect(file).toContain(`automation_id: ${automation?.automation_id}`);
    expect(file).toContain('Long run every Saturday.');
  });

  it('refuses a second goal with the same name instead of overwriting the first', async () => {
    const context = await create_runtime_context();
    await create_goal_tool.execute(goal_input, context);
    const again = await create_goal_tool.execute(goal_input, context);

    expect(again.success).toBe(false);
    expect(again.success === false && again.error.code).toBe('goal_already_exists');
    expect(await list_goal_automations(context)).toHaveLength(1);
  });

  it('refuses to start standing work from a background run', async () => {
    const context = await create_runtime_context();
    const background = { ...context, actor_id: 'system:trigger' };
    const result = await create_goal_tool.execute(goal_input, background);

    expect(result.success).toBe(false);
    expect(volume.size).toBe(0);
    expect(await list_goal_automations(context)).toHaveLength(0);
  });

  it('lists the active goals and records what moved', async () => {
    const context = await create_runtime_context();
    await create_goal_tool.execute(goal_input, context);
    const updated = await update_goal_tool.execute(
      {
        slug: 'sub-4-hour-marathon',
        progress: '18k done, legs fine',
        plan: 'Long run on Fridays.',
      },
      context,
    );
    expect(updated.success).toBe(true);
    expect(volume.get('goals/sub-4-hour-marathon.md')).toContain('18k done, legs fine');
    expect(volume.get('goals/sub-4-hour-marathon.md')).toContain('Long run on Fridays.');

    const listed = await list_goals_tool.execute({ include_done: false }, context);
    expect(listed.success && (listed.data as { goals: unknown[] }).goals).toHaveLength(1);

    await update_goal_tool.execute({ slug: 'sub-4-hour-marathon', status: 'done' }, context);
    const after = await list_goals_tool.execute({ include_done: false }, context);
    expect(after.success && (after.data as { goals: unknown[] }).goals).toHaveLength(0);
  });
});
