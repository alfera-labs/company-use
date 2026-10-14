import { create_logger, format_error_message } from '@coworker/shared';
import {
  create_e2b_command_env,
  e2b_working_directory,
  join_shell_command,
} from '@runtime-platform/orchestrator/e2b_command';
import { archil_checkin, archil_checkout } from '@runtime-platform/orchestrator/e2b_volume';
import { browser_state_path } from '@runtime-platform/orchestrator/e2b_volume_scripts';
import type { WorkspaceLayout } from '@runtime-platform/storage/workspace_layouts';
import type { Sandbox } from 'e2b';
import { z } from 'zod';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

const log = create_logger('e2b_volume_teardown');

/**
 * Saves browser state only under this sandbox's own claim. A claim held by another client is
 * forced away only when the caller knows no other run of the agent is live: a live peer holds
 * that claim for its whole run, and revoking it turned the peer's whole mount read-only.
 */
export async function save_browser_state_with_ownership(
  sandbox: E2bSandbox,
  roots: { volume_root: string; workspace_root: string },
  layout: WorkspaceLayout,
  input: { browser_command_env?: Record<string, string>; reclaim_stuck_browser_state: boolean },
) {
  if (!input.browser_command_env) return;
  const state_paths = [
    browser_state_path(roots, 'sessions', layout),
    browser_state_path(roots, 'auth', layout),
  ];
  const claims = await claim_browser_state_paths(
    sandbox,
    state_paths,
    input.reclaim_stuck_browser_state,
  );
  if (claims.owned_paths.length === 0) {
    const detail = `no write ownership of ${state_paths.join(' or ')}. Checkout failures: ${claims.failures.join('; ')}`;
    if (!input.reclaim_stuck_browser_state) {
      log.warn('Browser state not saved: another live run of this agent owns it.', { detail });
      return;
    }
    throw new Error(
      `Browser state not saved: ${detail}. Another client holds the delegation, or a previous sandbox left it claimed.`,
    );
  }
  try {
    await close_browser(sandbox, input.browser_command_env);
  } finally {
    await Promise.all(claims.owned_paths.map((state_path) => release_claim(sandbox, state_path)));
  }
}

async function release_claim(sandbox: E2bSandbox, state_path: string) {
  await archil_checkin(sandbox, state_path).catch((error) => {
    log.warn('Could not release browser-state ownership.', {
      archil_path: state_path,
      error: format_error_message(error),
    });
  });
}

async function claim_browser_state_paths(
  sandbox: E2bSandbox,
  state_paths: string[],
  reclaim_stuck_browser_state: boolean,
) {
  const wait = reclaim_stuck_browser_state
    ? { attempts: 8, delay_ms: 2_000, reclaim_on_last_attempt: true }
    : { attempts: 1, delay_ms: 0 };
  const results = await Promise.allSettled(
    state_paths.map((state_path) => archil_checkout(sandbox, state_path, wait)),
  );
  return {
    owned_paths: state_paths.filter((_, index) => results[index]?.status === 'fulfilled'),
    failures: results.flatMap((result) =>
      result.status === 'rejected' ? [format_error_message(result.reason)] : [],
    ),
  };
}

async function close_browser(sandbox: E2bSandbox, browser_command_env?: Record<string, string>) {
  if (!browser_command_env) return;
  const result = await sandbox.commands.run(
    join_shell_command(['agent-browser', '--json', 'close']),
    {
      cwd: e2b_working_directory,
      timeoutMs: 30_000,
      envs: create_e2b_command_env(browser_command_env),
    },
  );
  assert_browser_state_saved(result.stdout);
}

const browser_close_response_schema = z.object({
  success: z.boolean().optional(),
  data: z.object({ saveStatus: z.string().optional(), saveError: z.string().nullish() }).optional(),
});

function assert_browser_state_saved(stdout: string) {
  const parsed = browser_close_response_schema.safeParse(parse_json(stdout));
  if (!parsed.success) throw new Error('Browser state save returned an invalid response.');
  const result = parsed.data;
  if (
    result.success !== true ||
    result.data?.saveError ||
    !['saved', 'no_browser'].includes(result.data?.saveStatus ?? '')
  ) {
    const detail = result.data?.saveError || `saveStatus=${result.data?.saveStatus ?? 'unknown'}`;
    throw new Error(`Browser state save failed: ${detail}`);
  }
}

function parse_json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
