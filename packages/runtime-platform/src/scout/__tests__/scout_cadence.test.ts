import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { runs } from '@coworker/core/db/schema';
import { scout_actor } from '@coworker/shared';
import {
  base_scout_interval_minutes,
  decide_scout_cadence,
  is_first_pulse_of_the_week,
} from '@runtime-platform/scout/scout_cadence';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-09-15T12:00:00.000Z');
const trigger_id = 'trg_scout';

describe('decide_scout_cadence', () => {
  it('lets a workspace that has never looked look now', async () => {
    const fixture = await create_fixture();

    const decision = await decide_scout_cadence(fixture.db, { ...fixture, trigger_id, now });

    expect(decision.should_run).toBe(true);
  });

  it('waits the base gap on normal and half of it on eager', async () => {
    const fixture = await create_fixture();
    await seed_last_look(fixture, (base_scout_interval_minutes / 2) * 60 * 1_000);

    const on_normal = await decide_scout_cadence(fixture.db, {
      ...fixture,
      trigger_id,
      now,
      policy_readers: policy_readers('mode: normal'),
    });
    const on_eager = await decide_scout_cadence(fixture.db, {
      ...fixture,
      trigger_id,
      now,
      policy_readers: policy_readers('mode: eager'),
    });

    expect(on_normal).toMatchObject({ should_run: false, code: 'scout_too_soon' });
    expect(on_eager.should_run).toBe(true);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  return { db, workspace_id: bootstrap.workspace_id, agent_id: bootstrap.agent_id };
}

async function seed_last_look(fixture: Awaited<ReturnType<typeof create_fixture>>, age_ms: number) {
  await fixture.db.insert(runs).values({
    run_id: 'run_last_look',
    workspace_id: fixture.workspace_id,
    session_id: 'ses_scout',
    agent_id: fixture.agent_id,
    trigger_id,
    run_status: 'completed',
    created_time: new Date(now.getTime() - age_ms),
    created_by: scout_actor,
    last_updated_by: scout_actor,
  });
}

function policy_readers(frontmatter: string) {
  return {
    resolve_address: async () => ({
      volume_id: 'vol_test',
      provider_volume_id: 'pv_test',
      region: undefined,
      volume_workspace_path: 'agents/agt_test',
      layout: current_workspace_layout,
    }),
    read_file: async () =>
      new TextEncoder().encode(['---', frontmatter, '---', ''].join('\n')) as Uint8Array,
  };
}

describe('is_first_pulse_of_the_week', () => {
  const monday_morning = new Date('2026-09-14T08:00:00Z');

  it('is the first look of a Monday and nothing else', () => {
    expect(is_first_pulse_of_the_week(monday_morning, null)).toBe(true);
    expect(is_first_pulse_of_the_week(monday_morning, new Date('2026-09-13T17:00:00Z'))).toBe(true);
    expect(is_first_pulse_of_the_week(monday_morning, new Date('2026-09-14T05:00:00Z'))).toBe(
      false,
    );
    expect(is_first_pulse_of_the_week(new Date('2026-09-15T08:00:00Z'), null)).toBe(false);
  });
});
