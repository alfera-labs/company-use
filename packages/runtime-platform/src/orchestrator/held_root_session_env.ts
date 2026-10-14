import type { SessionEnv } from '@agent-core/environment/session_env';
import { create_logger } from '@coworker/shared';
import type { RunHookLogContext } from '@runtime-platform/orchestrator/run_hook_attempt';

const log = create_logger('held_root_session_env');

/** The longest a read waits for a held root. After that the root is released for reads in this run. */
export const held_root_wait_budget_ms = 10_000;

/** A root path a prepare hook is still writing, and the promise that settles when it is done. */
export type RootHold = { root_path: string; ready: Promise<void> };

type TrackedHold = {
  root_path: string;
  names_root: (text: string) => boolean;
  ready: Promise<void>;
  done: boolean;
  released_for_reads: boolean;
};

const deepest_argument_level = 3;

const calls_that_only_read_files: ReadonlySet<string> = new Set([
  'read',
  'read_bytes',
  'read_file',
  'stat',
  'list',
  'grep',
  'glob',
]);

function escape_for_pattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function match_root_named_as_absolute_path(root_path: string) {
  const pattern = new RegExp(`(?:^|[^\\w./-])${escape_for_pattern(root_path)}(?:$|[^\\w.-])`);
  return (text: string) => pattern.test(text);
}

function strings_in(value: unknown, level = 0): string[] {
  if (typeof value === 'string') return [value];
  if (level >= deepest_argument_level || value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap((item) => strings_in(item, level + 1));
}

function track_hold(hold: RootHold): TrackedHold {
  const tracked: TrackedHold = {
    root_path: hold.root_path,
    names_root: match_root_named_as_absolute_path(hold.root_path),
    ready: hold.ready,
    done: false,
    released_for_reads: false,
  };
  void hold.ready.then(() => {
    tracked.done = true;
  });
  return tracked;
}

async function wait_within_budget(
  hold: TrackedHold,
  budget_ms: number,
  log_context: RunHookLogContext,
) {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), budget_ms);
  });
  const outcome = await Promise.race([hold.ready.then(() => 'ready' as const), expired]);
  clearTimeout(timer);
  if (outcome === 'ready' || hold.released_for_reads) return;
  hold.released_for_reads = true;
  log.warn('A sandbox read stopped waiting for a root a prepare hook is still writing.', {
    ...log_context,
    root_path: hold.root_path,
    budget_ms,
  });
}

function wait_for_hold(
  hold: TrackedHold,
  call_only_reads: boolean,
  budget_ms: number,
  log_context: RunHookLogContext,
) {
  if (!call_only_reads) return hold.ready;
  if (hold.released_for_reads) return undefined;
  return wait_within_budget(hold, budget_ms, log_context);
}

/**
 * The same environment, except that a call naming a held root waits until that root is ready. A read
 * waits for at most `budget_ms`; a write or a command waits until the root is ready, so the hook
 * cannot overwrite what the call changed. Calls that name no held root run at once.
 */
export function hold_root_paths_until_ready(
  environment: SessionEnv,
  holds: readonly RootHold[],
  log_context: RunHookLogContext,
  budget_ms = held_root_wait_budget_ms,
): SessionEnv {
  if (holds.length === 0) return environment;
  const tracked = holds.map(track_hold);
  const wait_for_named_roots = async (call_name: string, args: unknown[]) => {
    const held = tracked.filter((hold) => !hold.done);
    if (held.length === 0) return;
    const texts = strings_in(args);
    const named = held.filter((hold) => texts.some(hold.names_root));
    const call_only_reads = calls_that_only_read_files.has(call_name);
    await Promise.all(
      named.map((hold) => wait_for_hold(hold, call_only_reads, budget_ms, log_context)),
    );
  };
  return Object.fromEntries(
    Object.entries(environment).map(([name, value]) => [
      name,
      typeof value === 'function'
        ? async (...args: unknown[]) => {
            await wait_for_named_roots(name, args);
            return (value as (...method_args: unknown[]) => unknown)(...args);
          }
        : value,
    ]),
  ) as SessionEnv;
}
