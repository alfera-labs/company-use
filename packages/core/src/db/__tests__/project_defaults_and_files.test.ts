import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_file, get_file } from '@coworker/core/db/queries/files';
import { attach_project_file, detach_project_file } from '@coworker/core/db/queries/project_files';
import { set_project_member } from '@coworker/core/db/queries/project_members';
import { find_project, list_projects } from '@coworker/core/db/queries/projects';
import { describe, expect, it } from 'vitest';

describe('default projects', () => {
  it('creates one private Personal project and one workspace-wide Workspace project', async () => {
    const db = await create_test_database();
    const first = await bootstrap_default_workspace(db);
    await bootstrap_default_workspace(db);

    const projects = await list_projects(db, {
      workspace_id: first.workspace_id,
      visible_to_user_id: first.user_id,
    });
    expect(projects).toHaveLength(2);
    expect(projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          project_name: 'Personal',
          project_access: 'private',
          personal_for_user_id: first.user_id,
        }),
        expect.objectContaining({
          project_name: 'Workspace',
          project_access: 'workspace',
          is_workspace_default: true,
        }),
      ]),
    );
  });

  it('turns Personal into a member project when another participant is added', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const personal = (
      await list_projects(db, {
        workspace_id: bootstrap.workspace_id,
        visible_to_user_id: bootstrap.user_id,
      })
    ).find((project) => project.personal_for_user_id === bootstrap.user_id);
    if (!personal) throw new Error('Personal project missing');

    await set_project_member(db, {
      workspace_id: bootstrap.workspace_id,
      project_id: personal.project_id,
      grantee_type: 'agent',
      grantee_id: bootstrap.agent_id,
      grant_level: 'use',
      actor_id: bootstrap.user_id,
    });

    expect(
      await find_project(db, {
        workspace_id: bootstrap.workspace_id,
        project_id: personal.project_id,
      }),
    ).toMatchObject({ project_access: 'members', personal_for_user_id: null });
  });
});

describe('project files', () => {
  it('detaches a file without deleting its row', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const project = (
      await list_projects(db, {
        workspace_id: bootstrap.workspace_id,
        visible_to_user_id: bootstrap.user_id,
      })
    ).find((row) => row.is_workspace_default);
    if (!project) throw new Error('Workspace project missing');
    const file = await create_file(db, {
      workspace_id: bootstrap.workspace_id,
      file_purpose: 'test',
      storage_provider: 'object_store',
      storage_key: `workspace/${bootstrap.workspace_id}/files/test/notes.txt`,
      file_name: 'notes.txt',
      actor_id: bootstrap.user_id,
    });

    await attach_project_file(db, {
      workspace_id: bootstrap.workspace_id,
      project_id: project.project_id,
      file_id: file.file_id,
      actor_id: bootstrap.user_id,
    });
    await detach_project_file(db, {
      workspace_id: bootstrap.workspace_id,
      project_id: project.project_id,
      file_id: file.file_id,
      actor_id: bootstrap.user_id,
    });

    expect(await get_file(db, bootstrap.workspace_id, file.file_id)).toMatchObject({
      file_id: file.file_id,
      project_id: null,
    });
  });
});
