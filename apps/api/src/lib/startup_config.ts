import { development_proxy_secret } from '@api/lib/proxy_identity';
import { env, RivetEndpointMissingError } from '@coworker/config';
import {
  has_test_runner_marks,
  is_team_mode_switched_on,
  read_team_mode_conflict,
} from '@coworker/config/local_mode_switch';

type ApiStartupConfig = {
  NODE_ENV: 'development' | 'test' | 'production';
  EVENT_JOB_DISPATCH_MODE: 'in_process' | 'http' | 'rivet';
  COWORKER_API_PROXY_SECRET?: string | undefined;
  RIVET_ENDPOINT?: string | undefined;
  COWORKER_WORKSPACE_RUNTIME_PROVIDER: 'local' | 'docker' | 'e2b';
  COWORKER_SELF_HOSTED?: boolean | undefined;
  COWORKER_PERSISTENT_WORKSPACES_ENABLED: boolean;
  E2B_API_KEY?: string | undefined;
  ARCHIL_API_KEY?: string | undefined;
  ARCHIL_REGION?: string | undefined;
  R2_BUCKET_NAME?: string | undefined;
  R2_BUCKET_ENDPOINT?: string | undefined;
  R2_ACCESS_KEY_ID?: string | undefined;
  R2_SECRET_ACCESS_KEY?: string | undefined;
  COWORKER_CREDENTIAL_ENCRYPTION_KEY?: string | undefined;
  COWORKER_BROWSER_STATE_ENCRYPTION_KEY?: string | undefined;
};

export function validate_api_startup_config(config: ApiStartupConfig = env) {
  validate_in_process_event_job_dispatch(config);
  validate_http_event_job_dispatch(config);
  validate_rivet_event_job_dispatch(config);
  validate_production_workspace_runtime(config);
  refuse_team_mode_beside_a_sign_in_provider();
  refuse_a_weak_proxy_secret_in_team_mode(config);
  const test_runner_refusal = find_test_runner_marks_refusal(env.NODE_ENV, has_test_runner_marks());
  if (test_runner_refusal) throw new Error(test_runner_refusal);
}

/**
 * Why a server must not start with the marks of the test runner, or null. The marks make the
 * API serve a test workspace to a request with no secret, and a process that runs with
 * NODE_ENV=production is a server. The mode asked about is the one of this process, not of
 * the config a caller hands in.
 */
export function find_test_runner_marks_refusal(
  node_env: string,
  has_marks: boolean,
): string | null {
  if (node_env !== 'production' || !has_marks) return null;
  return 'VITEST or VITEST_WORKER_ID is set and NODE_ENV=production. Those are the marks of the test runner, and a server must not carry them. Remove them from the environment of this container.';
}

function refuse_team_mode_beside_a_sign_in_provider() {
  const conflict = read_team_mode_conflict();
  if (conflict) throw new Error(conflict);
}

const shortest_proxy_secret_in_team_mode = 32;

function refuse_a_weak_proxy_secret_in_team_mode(config: ApiStartupConfig) {
  if (!is_team_mode_switched_on()) return;
  const secret = config.COWORKER_API_PROXY_SECRET?.trim() ?? '';
  if (secret.length >= shortest_proxy_secret_in_team_mode && secret !== development_proxy_secret) {
    return;
  }
  throw new Error(
    `COWORKER_AUTH_MODE=team needs COWORKER_API_PROXY_SECRET set to a secret of this install, at least ${shortest_proxy_secret_in_team_mode} characters long. It is all that stands between a caller on the network and any identity the caller claims, and the development value is public. Make one with: openssl rand -hex 32`,
  );
}

function validate_in_process_event_job_dispatch(config: ApiStartupConfig) {
  if (config.EVENT_JOB_DISPATCH_MODE !== 'in_process' || config.NODE_ENV === 'test') return;
  throw new Error(
    'EVENT_JOB_DISPATCH_MODE=in_process is for unit tests only: the API server must not run jobs. Use EVENT_JOB_DISPATCH_MODE=rivet (`bun run setup:worktree` writes it) and run the queue worker (apps/worker).',
  );
}

function validate_rivet_event_job_dispatch(config: ApiStartupConfig) {
  if (config.EVENT_JOB_DISPATCH_MODE !== 'rivet') return;
  if (!config.RIVET_ENDPOINT) throw new RivetEndpointMissingError();
}

function validate_http_event_job_dispatch(config: ApiStartupConfig) {
  if (config.EVENT_JOB_DISPATCH_MODE !== 'http') return;
  if ((config.COWORKER_API_PROXY_SECRET?.trim().length ?? 0) < 16) {
    throw new Error(
      'COWORKER_API_PROXY_SECRET with at least 16 characters is required for HTTP event-job dispatch.',
    );
  }
}

function validate_production_workspace_runtime(config: ApiStartupConfig) {
  if (config.NODE_ENV !== 'production') return;
  const provider = config.COWORKER_WORKSPACE_RUNTIME_PROVIDER;
  const docker_on_a_self_host = provider === 'docker' && config.COWORKER_SELF_HOSTED === true;
  if (provider !== 'e2b' && !docker_on_a_self_host) {
    throw new Error(
      [
        `COWORKER_WORKSPACE_RUNTIME_PROVIDER=${provider} is not supported in production.`,
        'Production containers do not provide a nested Docker daemon, and local mode would execute user commands inside the API container.',
        'Set COWORKER_WORKSPACE_RUNTIME_PROVIDER=e2b. A self-hosted install with a mounted Docker socket sets COWORKER_SELF_HOSTED=true and COWORKER_WORKSPACE_RUNTIME_PROVIDER=docker.',
      ].join(' '),
    );
  }
  if (provider === 'e2b' && !config.E2B_API_KEY) {
    throw new Error('E2B_API_KEY is required when COWORKER_WORKSPACE_RUNTIME_PROVIDER=e2b.');
  }
  validate_persistent_workspace_storage(config);
}

function validate_persistent_workspace_storage(config: ApiStartupConfig) {
  if (config.COWORKER_WORKSPACE_RUNTIME_PROVIDER !== 'e2b') return;
  if (!config.COWORKER_PERSISTENT_WORKSPACES_ENABLED) return;
  const missing = [
    ['ARCHIL_API_KEY', config.ARCHIL_API_KEY],
    ['ARCHIL_REGION', config.ARCHIL_REGION],
    ['R2_BUCKET_NAME', config.R2_BUCKET_NAME],
    ['R2_BUCKET_ENDPOINT', config.R2_BUCKET_ENDPOINT],
    ['R2_ACCESS_KEY_ID', config.R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', config.R2_SECRET_ACCESS_KEY],
    ['COWORKER_CREDENTIAL_ENCRYPTION_KEY', config.COWORKER_CREDENTIAL_ENCRYPTION_KEY],
    ['COWORKER_BROWSER_STATE_ENCRYPTION_KEY', config.COWORKER_BROWSER_STATE_ENCRYPTION_KEY],
  ].flatMap(([name, value]) => (value ? [] : [name]));
  if (missing.length > 0) {
    throw new Error(`Persistent workspace storage is missing: ${missing.join(', ')}.`);
  }
}
