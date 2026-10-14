type SandboxEnvRule = { purpose: string; credential_exception?: string };

export const sandbox_env_allowlist = {
  HOME: { purpose: 'home directory for tool dotfiles' },
  TMPDIR: { purpose: 'scratch directory' },
  USER: { purpose: 'process user name' },
  LOGNAME: { purpose: 'process user name' },
  SHELL: { purpose: 'shell for commands' },
  LANG: { purpose: 'text encoding' },
  PATH: { purpose: 'executable search path (local docker runtime only)' },
  NODE_OPTIONS: { purpose: 'makes Node trust the egress proxy certificate' },
  COWORKER_WORKSPACE_ROOT: { purpose: 'where the agent workspace is mounted' },
  AGENT_BROWSER_STREAM_PORT: { purpose: 'fixed port for the browser viewport stream' },
  AGENT_BROWSER_SESSION: { purpose: 'browser session name for this volume' },
  AGENT_BROWSER_RESTORE: { purpose: 'browser session to restore for this volume' },
  AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: { purpose: 'how often browser state is saved' },
  LIVE_VIEW_RELAY_PORT: { purpose: 'port the live-view relay listens on' },
  ARCHIL_MOUNT_TOKEN: {
    purpose: 'lets `archil mount` (run as root) attach this workspace disk',
    credential_exception:
      'Scoped to one workspace disk that this sandbox mounts read-write anyway, and passed only to ' +
      'the root mount command, not to agent commands. Open question: whether agent code can read ' +
      'it back from the mount process (sudo, /proc/<pid>/environ).',
  },
  AGENT_BROWSER_ENCRYPTION_KEY: {
    purpose: 'encrypts saved browser state on the workspace disk',
    credential_exception:
      'Derived per volume (HMAC of the master key); it only decrypts this volume’s own browser ' +
      'state, which the sandbox already uses. The master key never enters the sandbox.',
  },
  AGENT_BROWSER_LIVE_VIEW_TOKEN: {
    purpose: 'bearer the in-sandbox live-view relay checks on each viewer connection',
    credential_exception:
      'Derived per sandbox (HMAC of the master key); it only opens this sandbox’s own live view. ' +
      'The relay that checks it runs inside the sandbox, so the value must be there.',
  },
} as const satisfies Record<string, SandboxEnvRule>;

export type SandboxEnvKey = keyof typeof sandbox_env_allowlist;
export type SandboxEnv = Partial<Record<SandboxEnvKey, string>>;

export function create_sandbox_env(values: SandboxEnv): Record<string, string> {
  const refused = Object.keys(values).filter((key) => !Object.hasOwn(sandbox_env_allowlist, key));
  if (refused.length > 0) {
    throw new Error(
      `Refused to pass ${refused.join(', ')} into the sandbox: not in sandbox_env_allowlist. ` +
        'Credentials reach vendors through the egress proxy, never the sandbox environment.',
    );
  }
  return values as Record<string, string>;
}
