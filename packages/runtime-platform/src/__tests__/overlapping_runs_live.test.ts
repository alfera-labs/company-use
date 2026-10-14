import { env } from '@coworker/config';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { runs } from '@coworker/core/db/schema';
import {
  delete_test_disk,
  read_live_test_config,
} from '@runtime-platform/__tests__/archil_live_cleanup';
import {
  bootstrap_live_test_workspace,
  create_live_workspace,
  provider_sandbox_id,
  save_browser_state,
  stop_live_workspace,
} from '@runtime-platform/__tests__/archil_live_fixture';
import { kill_e2b_sandbox } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import type { OpenedCodingWorkspace } from '@runtime-platform/orchestrator/workspace_runtime';
import { provision_volume } from '@runtime-platform/storage/volume_provisioner';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

type Database = Awaited<ReturnType<typeof create_test_database>>;
type LiveRun = Awaited<ReturnType<typeof create_live_workspace>>;

const ledger_path = 'clients/overlap-test/handled.csv';
const browser_autosave_wait_ms = 30_000;

describe.runIf(env.COWORKER_ARCHIL_LIVE_TEST_ENABLED)('two live runs of one agent', () => {
  it(
    'keeps writing in the run that is still working when the other run closes',
    async () => {
      const config = read_live_test_config();
      const db = await create_test_database();
      const bootstrap = await bootstrap_live_test_workspace(db);
      const sandbox_ids = new Set<string>();
      let provider_volume_id: string | undefined;
      let holder: LiveRun | undefined;
      let test_error: unknown;
      try {
        const volume = await provision_volume(db, {
          workspace_id: bootstrap.workspace_id,
          actor_id: bootstrap.user_id,
        });
        provider_volume_id = volume.provider_volume_id ?? undefined;

        holder = await create_live_workspace(db, bootstrap, 'still-working');
        await set_run_status(db, holder, 'running');
        await append_ledger_line(holder.workspace, 'written before the other run closed');
        sandbox_ids.add(provider_sandbox_id(holder.workspace));
        await save_browser_state(holder.workspace);

        const finished = await create_live_workspace(db, bootstrap, 'finishes-first');
        await finished.workspace.environment.exec?.({ command: 'true', args: [] });
        sandbox_ids.add(provider_sandbox_id(finished.workspace));
        await set_run_status(db, finished, 'completed');
        await stop_live_workspace(db, bootstrap, finished.workspace);

        await save_browser_state(holder.workspace);
        await new Promise((resolve) => setTimeout(resolve, browser_autosave_wait_ms));
        await append_ledger_line(holder.workspace, 'written after the other run closed');
        await expect(holder.workspace.environment.read?.(ledger_path)).resolves.toContain(
          'written after the other run closed',
        );
      } catch (error) {
        test_error = error;
      }
      const cleanup_errors = await clean_up({
        db,
        bootstrap,
        holder,
        sandbox_ids,
        config,
        provider_volume_id,
      });
      if (test_error || cleanup_errors.length > 0) {
        throw new AggregateError(
          [test_error, ...cleanup_errors].filter((error) => error !== undefined),
          'The overlapping-runs live test or its cleanup failed.',
        );
      }
    },
    15 * 60_000,
  );
});

async function set_run_status(
  db: Database,
  live_run: LiveRun,
  run_status: 'running' | 'completed',
) {
  await db.update(runs).set({ run_status }).where(eq(runs.run_id, live_run.run.run_id));
}

async function append_ledger_line(workspace: OpenedCodingWorkspace, line: string) {
  const current = await workspace.environment.read?.(ledger_path).catch(() => '');
  await workspace.environment.write?.(ledger_path, `${current ?? ''}${line}\n`);
}

async function clean_up(input: {
  db: Database;
  bootstrap: Awaited<ReturnType<typeof bootstrap_live_test_workspace>>;
  holder: LiveRun | undefined;
  sandbox_ids: Set<string>;
  config: ReturnType<typeof read_live_test_config>;
  provider_volume_id: string | undefined;
}) {
  const errors: unknown[] = [];
  if (input.holder) {
    await set_run_status(input.db, input.holder, 'completed');
    await stop_live_workspace(input.db, input.bootstrap, input.holder.workspace).catch((error) =>
      errors.push(error),
    );
  }
  await Promise.allSettled(
    [...input.sandbox_ids].map((sandbox_id) => kill_e2b_sandbox(sandbox_id)),
  );
  if (input.provider_volume_id) {
    await delete_test_disk(
      input.config,
      input.provider_volume_id,
      input.bootstrap.workspace_id,
    ).catch((error) => errors.push(error));
  }
  return errors;
}
