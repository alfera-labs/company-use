import type { AgentPathStyle } from '@agent-core/environment/agent_visible_path';

type SessionEnvKind = 'local' | 'remote_sandbox' | 'custom';

export type SessionEnvCommandResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
};

export type SessionEnvExecInput = {
  command: string;
  args?: string[];
  cwd?: string;
  writable_paths?: string[];
  timeout_ms?: number;
  signal?: AbortSignal;
};

export type SessionEnvPreviewInput = {
  command: string;
  args?: string[];
  cwd?: string;
  port: number;
  ready_path?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
};

export type SessionEnvPreviewResult = {
  port: number;
  provider_host?: string;
  process_id?: number;
  ready_url?: string;
  command: string;
  cwd: string;
};

type SessionEnvBackgroundCommandInput = {
  command: string;
  args?: string[];
  cwd?: string;
  signal?: AbortSignal;
};

export type SessionEnvBackgroundCommandStatus = {
  background_command_id: string;
  status: 'running' | 'exited';
  exit_code?: number;
  command: string;
  cwd: string;
  started_time: string;
  stdout: string;
  stderr: string;
};

type SessionEnvBackgroundCommandCheckInput = {
  background_command_id: string;
  wait_seconds?: number;
};

export type SessionEnvFileEntry = {
  path: string;
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
};

type SessionEnvFileStat = {
  kind: 'file' | 'directory' | 'symlink' | 'other';
  byte_size: number;
};

export type SessionEnvEditInput = {
  path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
};

type SessionEnvEditResult = {
  replacements: number;
};

export type SessionEnvListInput = {
  path?: string;
  recursive?: boolean;
  max_depth?: number;
};

export type SessionEnvGrepInput = {
  pattern: string;
  path?: string;
  case_sensitive?: boolean;
  max_results?: number;
};

export type SessionEnvGrepMatch = {
  path: string;
  line: number;
  text: string;
};

export type SessionEnvGlobInput = {
  pattern: string;
  max_results?: number;
};

type SessionEnvMetadata = Record<string, unknown> & {
  runtime_environment_id?: string;
  provider_environment_id?: string;
  project_description?: string;
  app_description?: string;
  workspace_mount_key?: string;
  model_working_directory?: string;
  agent_tools_address_files_by?: AgentPathStyle;
  workspace_layout_version?: number;
};

export type SessionEnv = {
  env_key: string;
  env_kind: SessionEnvKind;
  working_directory?: string;
  metadata?: SessionEnvMetadata;
  exec?: (input: SessionEnvExecInput) => Promise<SessionEnvCommandResult>;
  read?: (path: string) => Promise<string>;
  read_bytes?: (path: string) => Promise<Uint8Array>;
  write_bytes?: (path: string, source: ReadableStream<Uint8Array>) => Promise<void>;
  stat?: (path: string) => Promise<SessionEnvFileStat | null>;
  write?: (path: string, contents: string) => Promise<void>;
  edit?: (input: SessionEnvEditInput) => Promise<SessionEnvEditResult>;
  list?: (input?: SessionEnvListInput) => Promise<SessionEnvFileEntry[]>;
  grep?: (input: SessionEnvGrepInput) => Promise<SessionEnvGrepMatch[]>;
  glob?: (input: SessionEnvGlobInput) => Promise<string[]>;
  start_preview?: (input: SessionEnvPreviewInput) => Promise<SessionEnvPreviewResult>;
  start_background_command?: (
    input: SessionEnvBackgroundCommandInput,
  ) => Promise<SessionEnvBackgroundCommandStatus>;
  check_background_command?: (
    input: SessionEnvBackgroundCommandCheckInput,
  ) => Promise<SessionEnvBackgroundCommandStatus | null>;
  stop_background_command?: (input: {
    background_command_id: string;
  }) => Promise<SessionEnvBackgroundCommandStatus | null>;
  list_background_commands?: () => Promise<SessionEnvBackgroundCommandStatus[]>;
  read_file?: (path: string) => Promise<string>;
  write_file?: (path: string, contents: string) => Promise<void>;
  run_command?: (command: string, args: string[]) => Promise<SessionEnvCommandResult>;
};
