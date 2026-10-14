import { execFile } from 'node:child_process';
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  create_local_session_paths,
  glob_search_root,
} from '@agent-core/environment/local_session_paths';
import {
  is_memory_root_path,
  read_open_memory_slugs,
} from '@agent-core/environment/memory_root_path';
import {
  read_file_inside_roots,
  replace_file_inside_roots,
  with_folder_inside_roots,
  write_file_inside_roots,
} from '@agent-core/environment/open_inside_roots';
import { search_expression } from '@agent-core/environment/search_expression';
import type {
  SessionEnv,
  SessionEnvEditInput,
  SessionEnvExecInput,
  SessionEnvFileEntry,
  SessionEnvGlobInput,
  SessionEnvGrepInput,
  SessionEnvGrepMatch,
  SessionEnvListInput,
} from '@agent-core/environment/session_env';
import { assert_path_inside_workspace } from '@agent-core/environment/workspace_path_escape';

export type CreateLocalSessionEnvInput = {
  env_key?: string;
  workspace_root?: string;
  scratch_root?: string;
  working_directory: string;
  command_env?: Record<string, string>;
  metadata?: Record<string, unknown>;
  memory_root_directory?: string;
};

const exec_file = promisify(execFile);
const default_max_results = 500;

export function create_local_session_env(input: CreateLocalSessionEnvInput): SessionEnv {
  const workspace_root = realpathSync(
    path.resolve(input.workspace_root ?? input.working_directory),
  );
  const default_working_directory = realpathSync(path.resolve(input.working_directory));
  assert_path_inside_workspace(workspace_root, default_working_directory, input.working_directory);
  const command_env = input.command_env ?? create_default_command_env(workspace_root);

  const metadata: Record<string, unknown> = {
    workspace_root,
    command_env_keys: Object.keys(command_env).sort(),
    // This environment also exposes pi's coding tools, which resolve against the real
    // filesystem from working_directory and cannot open a /work path.
    agent_tools_address_files_by: 'working_directory_relative_path',
    ...input.metadata,
  };
  const {
    resolve_safe_path,
    resolve_safe_absolute_path,
    assert_real_path_inside_workspace,
    inside_workspace,
    to_workspace_path,
    to_backing_path,
  } = create_local_session_paths({
    workspace_root,
    scratch_root: input.scratch_root,
    memory_root_directory: input.memory_root_directory,
    read_open_slugs: () => read_open_memory_slugs(metadata),
  });

  const get_entry_kind = (entry: {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }) => {
    if (entry.isFile()) return 'file' as const;
    if (entry.isDirectory()) return 'directory' as const;
    if (entry.isSymbolicLink()) return 'symlink' as const;
    return 'other' as const;
  };

  const list_entries = async (
    list_input: SessionEnvListInput = {},
  ): Promise<SessionEnvFileEntry[]> => {
    const workspace_path = list_input.path ?? '.';
    const root = resolve_safe_path(workspace_path);
    const read_folder = (directory: string) =>
      inside_workspace(workspace_path, (allowed_roots) =>
        with_folder_inside_roots(allowed_roots, directory, (folder_path) =>
          fs.readdir(folder_path, { withFileTypes: true }),
        ),
      );
    const recursive = list_input.recursive ?? false;
    const max_depth = list_input.max_depth ?? (recursive ? 4 : 1);
    const entries: SessionEnvFileEntry[] = [];

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > max_depth) return;
      const dir_entries = await read_folder(directory);
      for (const dir_entry of dir_entries) {
        const absolute_path = path.join(directory, dir_entry.name);
        const workspace_path = to_workspace_path(absolute_path);
        entries.push({
          path: workspace_path,
          name: dir_entry.name,
          kind: get_entry_kind(dir_entry),
        });

        if (recursive && dir_entry.isDirectory()) {
          await walk(to_backing_path(absolute_path), depth + 1);
        }
      }
    };

    await walk(root, 1);
    return entries;
  };

  const read = async (file_path: string): Promise<string> => {
    const buffer = await inside_workspace(file_path, read_file_inside_roots);
    if (buffer.includes(0)) {
      throw new Error(
        `Cannot read ${file_path} as text: it is a binary file. ` +
          'Use a format-aware command (via exec) to extract its contents.',
      );
    }
    return buffer.toString('utf8');
  };

  const read_bytes = async (file_path: string): Promise<Uint8Array> => {
    const buffer = await inside_workspace(file_path, read_file_inside_roots);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  };

  const write = (file_path: string, contents: string): Promise<void> =>
    inside_workspace(file_path, (allowed_roots, absolute_path) =>
      write_file_inside_roots(allowed_roots, absolute_path, contents),
    );

  const write_bytes: NonNullable<SessionEnv['write_bytes']> = (file_path, source) =>
    inside_workspace(file_path, (allowed_roots, absolute_path) =>
      replace_file_inside_roots(allowed_roots, absolute_path, (new_file) =>
        source.pipeTo(new WritableStream({ write: (chunk) => new_file.appendFile(chunk) })),
      ),
    );

  const stat: NonNullable<SessionEnv['stat']> = async (file_path) => {
    const absolute_path = resolve_safe_path(file_path);
    try {
      await assert_real_path_inside_workspace(absolute_path, file_path);
      const metadata = await fs.lstat(absolute_path);
      return { kind: file_kind(metadata), byte_size: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };

  const edit = async (edit_input: SessionEnvEditInput) => {
    if (edit_input.old_text.length === 0) {
      throw new Error('old_text must not be empty');
    }

    const current = await read(edit_input.path);
    const replace_all = edit_input.replace_all ?? false;
    const replacements = replace_all
      ? current.split(edit_input.old_text).length - 1
      : current.includes(edit_input.old_text)
        ? 1
        : 0;

    if (replacements === 0) {
      return { replacements: 0 };
    }

    const next = replace_all
      ? current.split(edit_input.old_text).join(edit_input.new_text)
      : current.replace(edit_input.old_text, edit_input.new_text);

    await write(edit_input.path, next);
    return { replacements };
  };

  const exec = async (exec_input: SessionEnvExecInput) => {
    for (const memory_path of (exec_input.writable_paths ?? []).filter(is_memory_root_path)) {
      resolve_safe_path(memory_path);
    }
    const cwd = exec_input.cwd
      ? resolve_safe_path(exec_input.cwd)
      : resolve_safe_absolute_path(default_working_directory);
    await assert_real_path_inside_workspace(cwd, exec_input.cwd ?? default_working_directory);
    try {
      const result = await exec_file(exec_input.command, exec_input.args ?? [], {
        cwd,
        env: command_env as NodeJS.ProcessEnv,
        signal: exec_input.signal,
        timeout: exec_input.timeout_ms ?? 30_000,
        maxBuffer: 1024 * 1024 * 4,
      });
      return {
        exit_code: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      const exec_error = error as {
        code?: number | string;
        killed?: boolean;
        signal?: string;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      const timed_out = exec_error.killed === true && exec_input.signal?.aborted !== true;
      return {
        exit_code: typeof exec_error.code === 'number' ? exec_error.code : 1,
        stdout: exec_error.stdout?.toString() ?? '',
        stderr: exec_error.stderr?.toString() ?? String(error),
        ...(timed_out ? { timed_out } : {}),
      };
    }
  };

  const glob_to_regex = (pattern: string): RegExp => {
    const slash_separated_pattern = pattern.split(path.sep).join('/');
    let source = '^';
    for (let index = 0; index < slash_separated_pattern.length; index += 1) {
      const char = slash_separated_pattern[index];
      const next = slash_separated_pattern[index + 1];
      if (char === '*' && next === '*') {
        source += '.*';
        index += 1;
      } else if (char === '*') {
        source += '[^/]*';
      } else if (char === '?') {
        source += '[^/]';
      } else {
        source += char?.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') ?? '';
      }
    }
    return new RegExp(`${source}$`);
  };

  const glob = async (glob_input: SessionEnvGlobInput): Promise<string[]> => {
    const max_results = glob_input.max_results ?? default_max_results;
    const expression = glob_to_regex(glob_input.pattern);
    const search_root = glob_search_root(glob_input.pattern);
    const entries = await list_entries({ path: search_root, recursive: true, max_depth: 32 });
    return entries
      .map((entry) => entry.path)
      .filter((entry_path) => expression.test(entry_path))
      .slice(0, max_results);
  };

  const grep = async (grep_input: SessionEnvGrepInput): Promise<SessionEnvGrepMatch[]> => {
    const root = grep_input.path ?? '.';
    const max_results = grep_input.max_results ?? default_max_results;
    const expression = search_expression(grep_input.pattern, grep_input.case_sensitive);
    const resolved_root = resolve_safe_path(root);
    await assert_real_path_inside_workspace(resolved_root, root);
    const root_stat = await fs.stat(resolved_root);
    const candidate_paths = root_stat.isDirectory()
      ? (await list_entries({ path: root, recursive: true, max_depth: 32 }))
          .filter((entry) => entry.kind === 'file')
          .map((entry) => entry.path)
      : [root];
    const matches: SessionEnvGrepMatch[] = [];

    for (const candidate_path of candidate_paths) {
      if (matches.length >= max_results) break;
      let contents: string;
      try {
        contents = await read(candidate_path);
      } catch {
        continue;
      }
      const lines = contents.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (expression.test(line)) {
          matches.push({ path: candidate_path, line: index + 1, text: line });
          if (matches.length >= max_results) break;
        }
      }
    }

    return matches;
  };

  return {
    env_key: input.env_key ?? 'local',
    env_kind: 'local',
    working_directory: default_working_directory,
    metadata,
    exec,
    read,
    read_bytes,
    write_bytes,
    stat,
    write,
    edit,
    list: list_entries,
    grep,
    glob,
    read_file: read,
    write_file: write,
    run_command: (command, args) => exec({ command, args }),
  };
}

function file_kind(metadata: Awaited<ReturnType<typeof fs.lstat>>) {
  if (metadata.isSymbolicLink()) return 'symlink' as const;
  if (metadata.isFile()) return 'file' as const;
  if (metadata.isDirectory()) return 'directory' as const;
  return 'other' as const;
}

function create_default_command_env(workspace_root: string) {
  return {
    ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
    HOME: workspace_root,
    TMPDIR: path.join(workspace_root, 'tmp'),
    USER: 'coworker',
    LOGNAME: 'coworker',
    SHELL: '/bin/bash',
    LANG: process.env.LANG ?? 'C.UTF-8',
  };
}
