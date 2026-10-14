import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEnv } from '@agent-core/environment';
import { create_local_session_env } from '@agent-core/environment/local_session_env';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { list_run_files } from '@coworker/core/db/queries/files';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { create_runtime_tool_definitions } from '@runtime-platform/tools/tool_execution_service';
import { describe, expect, it } from 'vitest';

async function create_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  await seed_runtime_tool_catalog(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const run = await create_run(db, {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    agent_id: actor.agent_id,
    trigger_type: 'user_message',
    actor_id: actor.user_id,
  });
  const ids = {
    workspace_id: actor.workspace_id,
    session_id: session.session_id,
    run_id: run.run_id,
    actor_id: actor.user_id,
  };
  return { db, ids };
}

type Fixture = Awaited<ReturnType<typeof create_fixture>>;

function sandbox_with_its_workspace_in_a_folder(env_kind: SessionEnv['env_kind']): SessionEnv {
  const workspace_folder = mkdtempSync(join(tmpdir(), 'command-written-files-'));
  return {
    ...create_local_session_env({
      workspace_root: workspace_folder,
      working_directory: workspace_folder,
      metadata: { workspace_layout_version: current_workspace_layout.layout_version },
    }),
    env_kind,
  };
}

let command_count = 0;

async function run_shell_line(fixture: Fixture, environment: SessionEnv, shell_line: string) {
  const tool = create_runtime_tool_definitions(fixture.db, { ...fixture.ids, environment }).find(
    (definition) => definition.tool_name === 'workspace-run_command',
  );
  if (!tool?.execute) throw new Error('workspace-run_command is not offered.');
  command_count += 1;
  return tool.execute(
    { command: shell_line },
    {
      run_key: fixture.ids.run_id,
      session_key: fixture.ids.session_id,
      tool_call_id: `model_command_${command_count}`,
      metadata: {},
      environment,
    },
  );
}

async function recorded_files(fixture: Fixture) {
  const files = await list_run_files(fixture.db, fixture.ids.workspace_id, fixture.ids.run_id);
  return files.map((file) => [file.workspace_path, file.file_purpose, file.byte_size]);
}

describe('the files a shell command wrote', () => {
  it('get a record each, by the rule of the write tool: not notes, not tmp, not hidden', async () => {
    const fixture = await create_fixture();
    const sandbox = sandbox_with_its_workspace_in_a_folder('custom');

    const result = await run_shell_line(
      fixture,
      sandbox,
      "mkdir -p reports/__pycache__ files/site/node_modules people tmp .venv && printf 'Hello' > hello.md && printf 'a,b\\n' > reports/week.csv && printf 'note' > people/a_person.md && printf 'x' > tmp/draft.md && printf 'y' > .venv/pyvenv.cfg && printf 'z' > reports/__pycache__/week.pyc && printf 'w' > files/site/node_modules/index.js",
    );

    expect(result).toMatchObject({ ok: true });
    expect((await recorded_files(fixture)).sort()).toEqual([
      ['hello.md', 'file', 5],
      ['reports/week.csv', 'file', 4],
    ]);
  });

  it('get no second record when a later command leaves them as they are', async () => {
    const fixture = await create_fixture();
    const sandbox = sandbox_with_its_workspace_in_a_folder('custom');

    await run_shell_line(fixture, sandbox, "printf 'Hello' > hello.md");
    await run_shell_line(fixture, sandbox, 'ls > /dev/null');
    await run_shell_line(fixture, sandbox, "printf 'Hello again' > hello.md");

    expect(await recorded_files(fixture)).toEqual([
      ['hello.md', 'file', 5],
      ['hello.md', 'file', 11],
    ]);
  });

  it('get a record also when the command failed after it wrote them', async () => {
    const fixture = await create_fixture();
    const sandbox = sandbox_with_its_workspace_in_a_folder('custom');

    const result = await run_shell_line(fixture, sandbox, "printf 'Hello' > hello.md && exit 3");

    expect(result).toMatchObject({ ok: false, error_code: 'command_failed' });
    expect(await recorded_files(fixture)).toEqual([['hello.md', 'file', 5]]);
  });

  it('get a record when the command moved them into place with an old date', async () => {
    const fixture = await create_fixture();
    const sandbox = sandbox_with_its_workspace_in_a_folder('custom');

    await run_shell_line(
      fixture,
      sandbox,
      "mkdir -p tmp files && printf 'PDF' > tmp/report.pdf && touch -t 202001010000 tmp/report.pdf && mv tmp/report.pdf files/report.pdf",
    );

    expect(await recorded_files(fixture)).toEqual([['files/report.pdf', 'file', 3]]);
  });

  it('get at most 20 records from one command: the newest files', async () => {
    const fixture = await create_fixture();
    const sandbox = sandbox_with_its_workspace_in_a_folder('custom');

    await run_shell_line(
      fixture,
      sandbox,
      'mkdir -p data && for n in $(seq 1 30); do printf x > data/part_$n.txt; done',
    );

    expect(await recorded_files(fixture)).toHaveLength(20);
  });

  it('get no record from here when the sandbox is remote', async () => {
    const fixture = await create_fixture();
    const sandbox = sandbox_with_its_workspace_in_a_folder('remote_sandbox');

    await run_shell_line(fixture, sandbox, "printf 'Hello' > hello.md");

    expect(await recorded_files(fixture)).toEqual([]);
  });
});
