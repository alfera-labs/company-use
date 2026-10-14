import { createHash } from 'node:crypto';
import type { SessionEnv } from '@agent-core/environment/session_env';
import { create_logger, format_error_message } from '@coworker/shared';
import { list_procedure_slugs } from '@runtime-platform/skills/procedure_folders';
import {
  parse_skill_file,
  parse_skill_sidecar,
  skill_file_name,
  skill_sidecar_file_name,
} from '@runtime-platform/skills/skill_file';
import {
  format_skill_index_page,
  read_skill_index,
  type SkillIndex,
  type SkillIndexEntry,
  serialize_skill_index,
  skill_index_file_name,
  skill_index_version,
} from '@runtime-platform/skills/skill_index_artifact';
import { procedures_folder } from '@runtime-platform/storage/workspace_layouts';

const log = create_logger('compile_workspace_skill_index');

const index_path = `${procedures_folder}/${skill_index_file_name}`;
const index_page_path = `${procedures_folder}/index.md`;
const maximum_skill_body_bytes = 200_000;

export type SkillCompileResult = {
  index: SkillIndex;
  rejected: { skill_slug: string; reason: string }[];
};

/** True when a path written this run means the index is now stale. */
export function path_changes_skill_index(workspace_path: string) {
  const normalized = workspace_path.replace(/^\/+/u, '');
  if (!normalized.startsWith(`${procedures_folder}/`)) return false;
  return !normalized.endsWith(`/${skill_index_file_name}`) && !normalized.endsWith('/index.md');
}

/**
 * Reads every procedure folder, parses it, and writes the index and its human twin.
 * A procedure that does not parse is left out of the index and reported, never guessed at.
 */
export async function compile_workspace_skill_index(
  environment: SessionEnv,
  now = new Date(),
): Promise<SkillCompileResult> {
  const compiled = await read_procedures_into_an_index(environment, now);
  await write_skill_index(environment, compiled.index);
  return compiled;
}

/**
 * Recompiles at run close, and writes only when the result differs from what is on the disk.
 *
 * The tool hook above only fires for a path written through `workspace-write_file` or
 * `workspace-edit_file`. A procedure created or moved with `workspace-run_command` — `mv`,
 * `cp`, a heredoc, `git checkout` — changed nothing it watches, so the index kept describing
 * the tree as it used to be: an index that parses cleanly and names none of the procedures
 * beside it.
 *
 * Compiling is cheap: a listing and one read per procedure, inside the sandbox, after the user
 * already has their answer. Writing is what is gated, because rewriting an unchanged artifact
 * every run buys nothing and churns the object.
 */
export async function recompile_skill_index_if_stale(
  environment: SessionEnv | undefined,
  now = new Date(),
): Promise<'written' | 'unchanged' | 'skipped'> {
  if (!environment?.write || !environment.read) return 'skipped';
  const compiled = await read_procedures_into_an_index(environment, now);
  if (await index_on_disk_matches(environment, compiled.index)) return 'unchanged';
  await write_skill_index(environment, compiled.index);
  log.info('Recompiled a workspace skill index that had fallen behind its folder.', {
    skill_slugs: compiled.index.entries.map((entry) => entry.skill_slug),
  });
  return 'written';
}

async function read_procedures_into_an_index(
  environment: SessionEnv,
  now: Date,
): Promise<SkillCompileResult> {
  const slugs = (await list_procedure_slugs(environment)) ?? [];
  const entries: SkillIndexEntry[] = [];
  const rejected: { skill_slug: string; reason: string }[] = [];

  for (const skill_slug of slugs) {
    const entry = await compile_one_procedure(environment, skill_slug);
    if ('reason' in entry) {
      rejected.push({ skill_slug, reason: entry.reason });
      continue;
    }
    entries.push(entry.entry);
  }

  entries.sort((left, right) => left.skill_slug.localeCompare(right.skill_slug));
  if (rejected.length > 0) {
    log.warn('Some procedures were left out of the skill index.', { rejected });
  }
  return { index: { skill_index_version, compiled_time: now.toISOString(), entries }, rejected };
}

async function write_skill_index(environment: SessionEnv, index: SkillIndex) {
  await environment.write?.(index_path, serialize_skill_index(index));
  await environment.write?.(index_page_path, format_skill_index_page(index));
}

async function index_on_disk_matches(environment: SessionEnv, index: SkillIndex) {
  const index_text = await environment.read?.(index_path).catch(() => undefined);
  if (index_text === undefined) return false;
  const parsed = read_skill_index(index_text);
  if (!parsed.ok) return false;
  return JSON.stringify(parsed.index.entries) === JSON.stringify(index.entries);
}

async function compile_one_procedure(
  environment: SessionEnv,
  skill_slug: string,
): Promise<{ entry: SkillIndexEntry } | { reason: string }> {
  const body_path = `${procedures_folder}/${skill_slug}/${skill_file_name}`;
  const file_text = await environment.read?.(body_path).catch(() => undefined);
  if (file_text === undefined) return { reason: `no ${skill_file_name}` };
  if (file_text.length > maximum_skill_body_bytes) {
    return { reason: `${skill_file_name} is over ${maximum_skill_body_bytes} bytes` };
  }

  const sidecar_text = await environment
    .read?.(`${procedures_folder}/${skill_slug}/${skill_sidecar_file_name}`)
    .catch(() => undefined);

  try {
    const parsed = parse_skill_file(file_text);
    const sidecar = parse_skill_sidecar(sidecar_text);
    return {
      entry: {
        skill_slug,
        skill_name: parsed.skill_name,
        skill_hint: parsed.description,
        body_path,
        content_hash: `sha256:${createHash('sha256').update(file_text).digest('hex')}`,
        preloaded_tool_keys: sidecar.preloaded_tool_keys,
        available_on_source_types: sidecar.available_on_source_types,
      },
    };
  } catch (error) {
    return { reason: format_error_message(error) };
  }
}
