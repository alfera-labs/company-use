import type { SessionEnv } from '@agent-core/environment/session_env';
import { has_consolidated_workspace_page } from '@coworker/memory';
import type { MemoryExecutor } from '@coworker/memory/contracts/dependencies';
import type { WorkspaceId } from '@coworker/memory/contracts/keys';
import { create_logger, format_error_message } from '@coworker/shared';
import { list_procedure_slugs } from '@runtime-platform/skills/procedure_folders';
import {
  type SkillIndex,
  unindexed_skill_hint,
} from '@runtime-platform/skills/skill_index_artifact';
import { list_folder_names } from '@runtime-platform/storage/workspace_folder_listing';
import {
  type WorkspaceLayout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';

const log = create_logger('workspace_digest');

const workspace_digest_path = 'WORKSPACE.md';
const listed_skill_limit = 20;
const listed_day_limit = 3;

export type WorkspaceDigest = { text: string };

export async function build_workspace_digest(
  environment: SessionEnv | undefined,
  skill_index: SkillIndex,
  now = new Date(),
): Promise<WorkspaceDigest> {
  const layout = workspace_layout_for_version(environment?.metadata?.workspace_layout_version);
  const counts = await count_folder_entries(environment, layout);
  const days = await list_recent_days(environment);
  const procedures = await read_procedures(environment, skill_index);

  const lines = ['# This workspace', ''];
  lines.push(
    `${total_pages(counts)} pages · ${procedures.count_text} · ${now.toISOString().slice(0, 10)}`,
    '',
  );

  lines.push('## What I can do here', ...procedures.lines);

  lines.push('', '## What I know');
  for (const folder of layout.folders) {
    if (!layout.memory_folders.includes(folder.path)) continue;
    lines.push(`- ${folder.path} (${counts[folder.path] ?? 0}) — ${folder.holds}`);
  }
  if (days.length > 0) lines.push(`- Most recent days: ${days.join(', ')}`);

  return { text: `${lines.join('\n')}\n` };
}

/**
 * False once DREAM's nightly consolidation has written a workspace profile page for this
 * workspace. The generated digest stops there: the consolidated page is now the one authoritative
 * workspace summary, and overwriting it with the generated digest would hide it.
 */
export async function workspace_digest_should_write(
  memory_executor: MemoryExecutor,
  workspace_id: WorkspaceId,
): Promise<boolean> {
  return !(await has_consolidated_workspace_page(memory_executor, workspace_id));
}

/**
 * Writes the digest to WORKSPACE.md. Never throws: a digest is never worth failing a run.
 *
 * Skipped for a workspace this platform did not lay out. WORKSPACE.md there is the owner's own
 * file, and replacing it with a generated one is the platform writing over something it did not
 * create — the same reason an older volume gets no folders and no activity record.
 */
export async function write_workspace_digest(
  environment: SessionEnv | undefined,
  digest: WorkspaceDigest,
) {
  const layout = workspace_layout_for_version(environment?.metadata?.workspace_layout_version);
  if (!layout.platform_lays_out_workspace) return;
  try {
    await environment?.write?.(workspace_digest_path, digest.text);
  } catch (error) {
    log.debug('Could not write the workspace digest.', {
      error: format_error_message(error),
    });
  }
}

async function read_procedures(environment: SessionEnv | undefined, skill_index: SkillIndex) {
  const hints = new Map(skill_index.entries.map((entry) => [entry.skill_slug, entry.skill_hint]));
  const slugs = await list_procedure_slugs(environment);

  if (!slugs) {
    return {
      count_text: 'procedures unreadable',
      lines: ['- Could not read skills/. List it yourself before deciding there is nothing there.'],
    };
  }
  if (slugs.length === 0) {
    return {
      count_text: '0 procedures',
      lines: ['- No procedures written yet. Write one the first time work repeats.'],
    };
  }

  const sorted = [...slugs].sort();
  const lines = sorted
    .slice(0, listed_skill_limit)
    .map((slug) => `- ${slug} — ${hints.get(slug) ?? unindexed_skill_hint}`);
  if (sorted.length > listed_skill_limit) {
    lines.push(`- ...and ${sorted.length - listed_skill_limit} more in skills/.`);
  }
  return {
    count_text: `${sorted.length} ${sorted.length === 1 ? 'procedure' : 'procedures'}`,
    lines,
  };
}

async function count_folder_entries(environment: SessionEnv | undefined, layout: WorkspaceLayout) {
  const counts: Record<string, number> = {};
  if (!environment?.list) return counts;
  for (const folder of layout.folders) {
    if (!layout.memory_folders.includes(folder.path)) continue;
    const names = (await list_folder_names(environment, folder.path)) ?? [];
    counts[folder.path] = names.filter((name) => name !== 'index.md').length;
  }
  return counts;
}

async function list_recent_days(environment: SessionEnv | undefined) {
  const names = (await list_folder_names(environment, 'daily-logs')) ?? [];
  return names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name) => name.replace(/\.md$/u, ''))
    .sort()
    .reverse()
    .slice(0, listed_day_limit);
}

function total_pages(counts: Record<string, number>) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}
