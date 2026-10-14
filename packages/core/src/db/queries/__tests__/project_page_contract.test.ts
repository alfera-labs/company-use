import { randomUUID } from 'node:crypto';
import { resolve_policy_mode } from '@coworker/core/access/policy_modes';
import { create_database } from '@coworker/core/db/connection';
import {
  find_personal_project,
  open_personal_project,
} from '@coworker/core/db/queries/personal_projects';
import { attach_project_file, list_project_files } from '@coworker/core/db/queries/project_files';
import { set_project_member } from '@coworker/core/db/queries/project_members';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { create_project, find_project } from '@coworker/core/db/queries/projects';
import { agents, files, users, workspace_members, workspaces } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database_url = process.env.DATABASE_URL;

if (process.env.COWORKER_REQUIRE_POSTGRES_TESTS === 'true' && !database_url) {
  throw new Error('COWORKER_REQUIRE_POSTGRES_TESTS is set but DATABASE_URL is not');
}

const suffix = randomUUID().slice(0, 8);
const workspace_id = `ws_page_${suffix}`;
const owner_id = `user_owner_${suffix}`;
const teammate_id = `user_mate_${suffix}`;
const stranger_id = `user_stranger_${suffix}`;
const agent_id = `agt_page_${suffix}`;
const actor_id = 'system:project_page_contract_test';

const db = database_url ? create_database(database_url) : undefined;
let marketing_id: string;

beforeAll(async () => {
  if (!db) return;
  await db.insert(workspaces).values({
    workspace_id,
    workspace_name: 'Page contract',
    workspace_slug: `page-contract-${suffix}`,
    created_by: actor_id,
    last_updated_by: actor_id,
  });
  for (const user_id of [owner_id, teammate_id, stranger_id]) {
    await db.insert(users).values({
      user_id,
      email: `${user_id}@example.test`,
      created_by: actor_id,
      last_updated_by: actor_id,
    });
    await db.insert(workspace_members).values({
      workspace_member_id: `wm_${user_id}`,
      workspace_id,
      user_id,
      created_by: actor_id,
      last_updated_by: actor_id,
    });
  }
  await db.insert(agents).values({
    agent_id,
    workspace_id,
    agent_name: 'Page contract coworker',
    created_by: actor_id,
    last_updated_by: actor_id,
  });

  marketing_id = (
    await create_project(db, {
      workspace_id,
      project_name: `Marketing ${suffix}`,
      project_access: 'members',
      project_instructions: 'Always write in British English.',
      actor_id: owner_id,
      owner_id,
    })
  ).project_id;
});

afterAll(async () => {
  if (!db) return;
  await db.delete(files).where(eq(files.workspace_id, workspace_id));
  await db.delete(agents).where(eq(agents.workspace_id, workspace_id));
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, workspace_id));
  await db.delete(workspaces).where(eq(workspaces.workspace_id, workspace_id));
  for (const user_id of [owner_id, teammate_id, stranger_id]) {
    await db.delete(users).where(eq(users.user_id, user_id));
  }
});

describe('the Access box — can I really add people', () => {
  it('lets the person who made it open it', async () => {
    if (!db) return;
    expect(
      await find_visible_project(db, { workspace_id, project_id: marketing_id, user_id: owner_id }),
    ).toBeTruthy();
  });

  it('hides it from someone who was never added', async () => {
    if (!db) return;
    expect(
      await find_visible_project(db, {
        workspace_id,
        project_id: marketing_id,
        user_id: stranger_id,
      }),
    ).toBeFalsy();
  });

  it('opens it to a teammate the moment they are added', async () => {
    if (!db) return;
    await set_project_member(db, {
      workspace_id,
      project_id: marketing_id,
      grantee_type: 'user',
      grantee_id: teammate_id,
      grant_level: 'use',
      actor_id: owner_id,
    });
    expect(
      await find_visible_project(db, {
        workspace_id,
        project_id: marketing_id,
        user_id: teammate_id,
      }),
    ).toBeTruthy();
  });

  it('still hides it from the stranger after that', async () => {
    if (!db) return;
    expect(
      await find_visible_project(db, {
        workspace_id,
        project_id: marketing_id,
        user_id: stranger_id,
      }),
    ).toBeFalsy();
  });

  it('bumps the membership version so a cached member list cannot go stale', async () => {
    if (!db) return;
    const project = await find_project(db, { workspace_id, project_id: marketing_id });
    expect(project?.membership_version).toBeGreaterThan(1);
  });
});

describe('the personal room — what happens when you share it', () => {
  it('stops being personal the moment a second person is added', async () => {
    if (!db) return;
    const personal = await open_personal_project(db, { workspace_id, user_id: owner_id });
    expect(personal.personal_for_user_id).toBe(owner_id);
    expect(personal.project_access).toBe('private');

    await set_project_member(db, {
      workspace_id,
      project_id: personal.project_id,
      grantee_type: 'user',
      grantee_id: teammate_id,
      grant_level: 'use',
      actor_id: owner_id,
    });

    const after = await find_project(db, { workspace_id, project_id: personal.project_id });
    expect(after?.personal_for_user_id).toBeNull();
    expect(after?.project_access).toBe('members');
    expect(await find_personal_project(db, { workspace_id, user_id: owner_id })).toBeNull();
  });
});

describe('the Files box — attaching does not move the bytes', () => {
  it('lists a file once it is attached, and lets it go without deleting it', async () => {
    if (!db) return;
    const file_id = `art_page_${suffix}`;
    await db.insert(files).values({
      file_id,
      workspace_id,
      file_purpose: 'reference',
      file_status: 'ready',
      storage_provider: 'object_store',
      storage_key: `probe/${file_id}`,
      file_name: 'brand-guide.pdf',
      created_by: owner_id,
      last_updated_by: owner_id,
    });

    await attach_project_file(db, {
      workspace_id,
      project_id: marketing_id,
      file_id,
      actor_id: owner_id,
    });
    const attached = await list_project_files(db, { workspace_id, project_id: marketing_id });
    expect(attached.map((file) => file.file_id)).toContain(file_id);
    expect(attached[0]?.storage_key).toBe(`probe/${file_id}`);
  });
});

describe('the Tool permissions box — what inherit actually means', () => {
  const email_tool = { resource_type: 'node', resource_id: 'node_send_email', specificity: 2 };
  const resources = [email_tool];
  const scopes = {
    workspace: [workspace_id],
    project: ['proj_marketing'],
    connection: [],
    agent: [],
    user: [],
  };

  it('lets a project tighten what the workspace allows', () => {
    expect(
      resolve_policy_mode({
        rules: [
          { ...email_tool, scope_type: 'workspace', scope_id: workspace_id, policy_mode: 'allow' },
          { ...email_tool, scope_type: 'project', scope_id: 'proj_marketing', policy_mode: 'ask' },
        ],
        resources,
        scopes,
      }),
    ).toBe('ask');
  });

  it('does NOT let a project loosen what the workspace refused', () => {
    expect(
      resolve_policy_mode({
        rules: [
          { ...email_tool, scope_type: 'workspace', scope_id: workspace_id, policy_mode: 'never' },
          {
            ...email_tool,
            scope_type: 'project',
            scope_id: 'proj_marketing',
            policy_mode: 'allow',
          },
        ],
        resources,
        scopes,
      }),
    ).toBe('never');
  });

  it('inherit means no rule at all, so the tool is simply allowed', () => {
    expect(resolve_policy_mode({ rules: [], resources, scopes })).toBe('allow');
  });
});
