import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { run_default_project_scope_backfill } from '@coworker/core/db/queries/default_project_scope_backfill';
import { create_project } from '@coworker/core/db/queries/projects';
import { open_workspace_project } from '@coworker/core/db/queries/workspace_projects';
import { brain_items, users, workspace_members } from '@coworker/core/db/schema';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Database;

beforeAll(async () => {
  db = await create_test_database();
});

async function add_member(workspace_id: string, email: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, created_by: 'system:test', last_updated_by: 'system:test' })
    .returning();
  if (!user) throw new Error('user seed failed');
  await db.insert(workspace_members).values({
    workspace_member_id: `wsm_${user.user_id}`,
    workspace_id,
    user_id: user.user_id,
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });
  return user.user_id;
}

async function insert_note(input: {
  brain_item_id: string;
  workspace_id: string;
  scope_key: string;
  slug: string;
}) {
  await db.insert(brain_items).values({
    brain_item_id: input.brain_item_id,
    workspace_id: input.workspace_id,
    brain_source_id: 'src_test',
    app_key: 'notes',
    external_item_id: input.brain_item_id,
    title: input.slug,
    slug: input.slug,
    item_kind: 'document',
    scope_key: input.scope_key,
    created_by: 'system:test',
    last_updated_by: 'system:test',
  });
}

describe('run_default_project_scope_backfill', () => {
  it('counts without moving on a dry run, and moves on a real run', async () => {
    const workspace_id = `ws_backfill_${Date.now()}`;
    const owner_id = await add_member(workspace_id, `backfill-${Date.now()}@example.com`);
    const default_project = await open_workspace_project(db, { workspace_id, user_id: owner_id });
    await insert_note({
      brain_item_id: `bri_${Date.now()}_1`,
      workspace_id,
      scope_key: `project:${default_project.project_id}`,
      slug: 'first-note',
    });
    await insert_note({
      brain_item_id: `bri_${Date.now()}_2`,
      workspace_id,
      scope_key: `project:${default_project.project_id}`,
      slug: 'second-note',
    });

    const dry_run_summary = await run_default_project_scope_backfill(db, {
      workspace_id,
      is_dry_run: true,
    });
    expect(dry_run_summary).toEqual({
      outcome: 'counted',
      default_project_scope_key: `project:${default_project.project_id}`,
      found_count: 2,
    });

    const real_run_summary = await run_default_project_scope_backfill(db, {
      workspace_id,
      is_dry_run: false,
    });
    expect(real_run_summary).toEqual({
      outcome: 'moved',
      default_project_scope_key: `project:${default_project.project_id}`,
      found_count: 2,
      moved_count: 2,
    });

    const moved_rows = await db.query.brain_items.findMany({
      where: (table, { eq }) => eq(table.workspace_id, workspace_id),
    });
    expect(moved_rows.every((row) => row.scope_key === 'workspace')).toBe(true);
  });

  it('reports no default project for a workspace that never opened one', async () => {
    const workspace_id = `ws_backfill_no_default_${Date.now()}`;

    const summary = await run_default_project_scope_backfill(db, {
      workspace_id,
      is_dry_run: true,
    });

    expect(summary).toEqual({ outcome: 'no_default_project' });
  });

  it('does not move a regular project scope, only the default one', async () => {
    const workspace_id = `ws_backfill_regular_${Date.now()}`;
    const owner_id = await add_member(workspace_id, `backfill-regular-${Date.now()}@example.com`);
    await open_workspace_project(db, { workspace_id, user_id: owner_id });
    const regular_project = await create_project(db, {
      workspace_id,
      project_name: `Regular ${Date.now()}`,
      project_access: 'members',
      actor_id: owner_id,
      owner_id,
    });
    await insert_note({
      brain_item_id: `bri_${Date.now()}_regular`,
      workspace_id,
      scope_key: `project:${regular_project.project_id}`,
      slug: 'regular-note',
    });

    const summary = await run_default_project_scope_backfill(db, {
      workspace_id,
      is_dry_run: false,
    });

    expect(summary).toMatchObject({ found_count: 0, moved_count: 0 });
    const regular_row = await db.query.brain_items.findFirst({
      where: (table, { eq }) => eq(table.workspace_id, workspace_id),
    });
    expect(regular_row?.scope_key).toBe(`project:${regular_project.project_id}`);
  });
});
