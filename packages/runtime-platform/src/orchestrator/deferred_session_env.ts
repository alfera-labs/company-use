import type { SessionEnv } from '@agent-core/environment/session_env';
import { create_logger } from '@coworker/shared';

const log = create_logger('deferred_session_env');

export type PlannedSessionEnv = Pick<SessionEnv, 'env_key' | 'env_kind' | 'working_directory'> & {
  metadata: NonNullable<SessionEnv['metadata']>;
};

export function create_deferred_session_env(input: {
  attaching: Promise<SessionEnv>;
  planned: PlannedSessionEnv;
}): SessionEnv {
  const { planned } = input;
  const attaching = input.attaching.then((environment) => {
    Object.assign(planned.metadata, environment.metadata);
    return environment;
  });
  attaching.catch((error) =>
    log.debug('session env attach failed; the next method call rethrows it', { error }),
  );
  return {
    ...planned,
    exec: wait_then_call(attaching, 'exec'),
    read: wait_then_call(attaching, 'read'),
    read_bytes: wait_then_call(attaching, 'read_bytes'),
    write_bytes: wait_then_call(attaching, 'write_bytes'),
    stat: wait_then_call(attaching, 'stat'),
    write: wait_then_call(attaching, 'write'),
    edit: wait_then_call(attaching, 'edit'),
    list: wait_then_call(attaching, 'list'),
    grep: wait_then_call(attaching, 'grep'),
    glob: wait_then_call(attaching, 'glob'),
    start_preview: wait_then_call(attaching, 'start_preview'),
    start_background_command: wait_then_call(attaching, 'start_background_command'),
    check_background_command: wait_then_call(attaching, 'check_background_command'),
    stop_background_command: wait_then_call(attaching, 'stop_background_command'),
    list_background_commands: wait_then_call(attaching, 'list_background_commands'),
    read_file: wait_then_call(attaching, 'read_file'),
    write_file: wait_then_call(attaching, 'write_file'),
    run_command: wait_then_call(attaching, 'run_command'),
  };
}

type SessionEnvMethodName = {
  [Name in keyof SessionEnv]-?: NonNullable<SessionEnv[Name]> extends (
    ...args: never[]
  ) => Promise<unknown>
    ? Name
    : never;
}[keyof SessionEnv];

function wait_then_call<Name extends SessionEnvMethodName>(
  attaching: Promise<SessionEnv>,
  method_name: Name,
): NonNullable<SessionEnv[Name]> {
  const call = async (...args: unknown[]) => {
    const environment = await attaching;
    const method = environment[method_name];
    if (!method) {
      throw new Error(`This session environment cannot ${method_name}.`);
    }
    return (method as (...method_args: unknown[]) => unknown)(...args);
  };
  return call as NonNullable<SessionEnv[Name]>;
}
