import { create_workspace_trigger } from '@api/services/triggers';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@api/services/scheduling/cron_schedule', () => ({
  get_cron_schedule: async () => ({
    supports_run_once: true,
    set_schedule: vi.fn(),
    pause_schedule: vi.fn(),
    delete_schedule: vi.fn(),
  }),
}));

type Database = Awaited<ReturnType<typeof create_test_database>>;

describe('user scheduled task spreading', () => {
  it('keeps every workspace within five minutes of the 9am they asked for', async () => {
    const db = await create_test_database();
    const minutes = new Set<string>();

    for (let index = 0; index < 30; index += 1) {
      const trigger = await create_user_task(db, {
        workspace_id: `ws_customer_${index}`,
        schedule_expression: '0 9 * * *',
      });
      const [minute, ...rest] = (trigger.schedule_expression ?? '').split(' ');
      expect(rest.join(' ')).toBe('9 * * *');
      expect(Number(minute)).toBeLessThan(5);
      minutes.add(minute ?? '');
    }

    expect(minutes.size).toBeGreaterThan(1);
  });

  it('leaves a cadence the user wrote themselves intact', async () => {
    const db = await create_test_database();

    const trigger = await create_user_task(db, {
      workspace_id: 'ws_carla',
      schedule_expression: '0 */4 * * *',
    });

    expect(trigger.schedule_expression).toBe('1 */4 * * *');
  });

  it('does not move a one-time task off the instant it was asked for', async () => {
    const db = await create_test_database();

    const trigger = await create_user_task(db, {
      workspace_id: 'ws_carla',
      schedule_expression: '30 14 21 5 *',
      run_once_at: '2099-05-21T14:30:00.000Z',
    });

    expect(trigger.schedule_expression).toBe('30 14 21 5 *');
  });
});

function create_user_task(
  db: Database,
  input: { workspace_id: string; schedule_expression: string; run_once_at?: string },
) {
  return create_workspace_trigger(db, {
    workspace_id: input.workspace_id,
    agent_id: 'agent_main',
    trigger_name: 'Morning digest',
    trigger_type: 'schedule',
    schedule_expression: input.schedule_expression,
    trigger_config: {
      starts_job_handler: 'run_scheduled_agent_task',
      ...(input.run_once_at ? { run_once_at: input.run_once_at } : {}),
      job_input: { instruction: 'Send the digest.' },
    },
    trigger_source: { origin: 'agent_tool' },
    actor_id: 'user_ana',
  });
}
