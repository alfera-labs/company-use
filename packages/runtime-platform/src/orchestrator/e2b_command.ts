import { agent_browser_stream_port } from '@agent-core/browser/agent_browser_command';
import { create_sandbox_env, type SandboxEnv } from '@runtime-platform/orchestrator/sandbox_env';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';

export const e2b_workspace_root = current_workspace_layout.model_root;
export const e2b_working_directory = current_workspace_layout.model_root;

export const sandbox_home_directory = '/tmp/coworker/home';

export const baked_browser_home = '/opt/coworker/browser';

export function create_e2b_command_env(extra_env: SandboxEnv = {}) {
  return create_sandbox_env({
    HOME: sandbox_home_directory,
    TMPDIR: '/tmp/coworker',
    USER: 'coworker',
    LOGNAME: 'coworker',
    SHELL: '/bin/bash',
    LANG: process.env.LANG ?? 'C.UTF-8',
    COWORKER_WORKSPACE_ROOT: e2b_workspace_root,
    // Pin the agent-browser viewport stream to a known port so the live-view relay can dial it.
    // The template also sets this, but E2B does not apply baked image env to `commands.run`, so
    // without it here the daemon (started by the first browser command) binds a random OS port
    // and the relay finds nothing at the fixed port — a live view that connects but never streams.
    AGENT_BROWSER_STREAM_PORT: String(agent_browser_stream_port),
    // Every request leaves through the egress proxy, which terminates TLS and presents its own
    // certificate. Node trusts only the ~120 CAs compiled into its binary, so it rejects that
    // certificate and reports the rejection as the uninformative "TypeError: fetch failed" —
    // the model reads that as transient and retries the identical command. The image installs
    // the proxy's CA in the system trust store, and --use-system-ca is what makes Node look
    // there, so a command carrying the flag works and the same command without it cannot.
    //
    // That makes correctness a coin flip: a node command works only when the model remembers
    // the flag, and a call without it dies at the handshake while the agent has no way to see
    // why. Setting it here removes the flag from what anyone has to remember. Node v24 accepts
    // NODE_OPTIONS=--use-system-ca, and a fetch through the proxy then answers.
    NODE_OPTIONS: '--use-system-ca',
    ...extra_env,
  });
}

export function join_shell_command(parts: string[]) {
  return parts.map(quote_shell_argument).join(' ');
}

export function quote_shell_argument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
