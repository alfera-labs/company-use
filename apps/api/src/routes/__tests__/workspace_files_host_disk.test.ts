import { rm } from 'node:fs/promises';
import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { open_or_create_coding_workspace } from '@coworker/runtime-platform';
import { afterAll, describe, expect, it, vi } from 'vitest';

const workspace_base_path = await vi.hoisted(async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const base_path = mkdtempSync(`${tmpdir()}/coworker-files-panel-`);
  mkdirSync(`${base_path}/bin`);
  writeFileSync(`${base_path}/bin/docker`, '#!/bin/sh\n', { mode: 0o755 });
  vi.stubEnv('PATH', `${base_path}/bin:${process.env.PATH}`);
  vi.stubEnv('COWORKER_WORKSPACE_BASE_PATH', base_path);
  vi.stubEnv('COWORKER_WORKSPACE_RUNTIME_PROVIDER', 'docker');
  return base_path;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(workspace_base_path, { recursive: true, force: true });
});

async function open_chat(db: Awaited<ReturnType<typeof create_test_database>>) {
  const bootstrap = await bootstrap_default_workspace(db);
  const owner = { workspace_id: bootstrap.workspace_id, agent_id: bootstrap.agent_id };
  const session = await create_session(db, {
    ...owner,
    session_title: 'Chat 1',
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    ...owner,
    session_id: session.session_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  return open_or_create_coding_workspace(db, {
    ...owner,
    session_id: session.session_id,
    run_id: run.run_id,
    actor_id: bootstrap.user_id,
  });
}

function files_route(route: string, query: Record<string, string>) {
  return `/v1/workspace/files${route}?${new URLSearchParams(query)}`;
}

async function read_data(response: Response) {
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

describe('the Files panel routes on a workspace kept on this machine', () => {
  it('says the folder is not ready before the first run made it', async () => {
    const db = await create_test_database();
    await bootstrap_default_workspace(db);

    const response = await create_app(db).request(files_route('', { folder_path: '' }));

    expect(await read_data(response)).toMatchObject({ volume_ready: false, files: [] });
  });

  it('lists, opens, downloads and saves a file a chat wrote', async () => {
    const db = await create_test_database();
    const chat = await open_chat(db);
    await chat.environment.write?.('files/audit-note.md', 'cash is fine');
    const app = create_app(db);

    const root = await read_data(await app.request(files_route('', { folder_path: '' })));
    expect(root).toMatchObject({ volume_ready: true });
    expect(root.folders).toEqual(
      expect.arrayContaining([
        {
          folder_name: 'files',
          description: 'what the agent produced or downloaded',
          is_empty: false,
        },
        expect.objectContaining({
          folder_name: 'skills',
          description: 'how the agent works: one folder per procedure',
        }),
      ]),
    );
    const folder = await read_data(await app.request(files_route('', { folder_path: 'files' })));
    expect(folder.files).toEqual([
      expect.objectContaining({ file_name: 'audit-note.md', byte_size: 12 }),
    ]);

    const file_path = 'files/audit-note.md';
    const opened = await read_data(await app.request(files_route('/content', { file_path })));
    expect(opened).toMatchObject({
      content_kind: 'text',
      content_text: 'cash is fine',
      may_edit: true,
    });
    const download = await app.request(files_route('/download', { file_path }));
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('cash is fine');

    const saved = await app.request('/v1/workspace/files/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file_path,
        content_text: 'cash is tight',
        expected_version: opened.content_version,
      }),
    });
    expect(saved.status).toBe(200);
    expect(await chat.environment.read?.(file_path)).toBe('cash is tight');
  });

  it('says which folders hold no file, and still answers with the hidden names', async () => {
    const db = await create_test_database();
    const chat = await open_chat(db);
    await chat.environment.write?.('files/audit-note.md', 'cash is fine');
    await chat.environment.write?.('.venv/pyvenv.cfg', 'home = /usr');
    const app = create_app(db);

    const root = await read_data(await app.request(files_route('', { folder_path: '' })));
    const folders = root.folders as { folder_name: string; is_empty: boolean }[];
    const is_empty = Object.fromEntries(
      folders.map((folder) => [folder.folder_name, folder.is_empty]),
    );

    expect(is_empty).toMatchObject({
      files: false,
      '.venv': false,
      people: true,
      system: true,
      tmp: true,
    });
  });

  it('refuses a path outside the workspace folder and reports a missing file', async () => {
    const db = await create_test_database();
    await open_chat(db);
    const app = create_app(db);

    const outside = await app.request(
      files_route('/content', { file_path: '../../../../../etc/passwd' }),
    );
    expect(outside.status).toBe(400);
    const missing = await app.request(files_route('/download', { file_path: 'files/none.md' }));
    expect(missing.status).toBe(404);
  });
});
