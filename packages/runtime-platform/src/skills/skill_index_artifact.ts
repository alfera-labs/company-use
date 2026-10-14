import { format_error_message } from '@coworker/shared';
import { skill_file_name } from '@runtime-platform/skills/skill_file';
import { z } from 'zod';

export const skill_index_file_name = 'INDEX.json';
export const skill_index_version = 1;

const skill_index_entry_schema = z
  .object({
    skill_slug: z.string().min(1).max(120),
    skill_name: z.string().min(1).max(120),
    skill_hint: z.string().min(1).max(1024),
    body_path: z.string().min(1).max(400),
    content_hash: z.string().min(1).max(200),
    preloaded_tool_keys: z.array(z.string().min(1).max(200)).max(32),
    available_on_source_types: z.array(z.string().min(1).max(40)).max(16).nullable(),
  })
  .strict();

const skill_index_schema = z
  .object({
    skill_index_version: z.number().int().positive(),
    compiled_time: z.string().min(1).max(64),
    entries: z.array(skill_index_entry_schema).max(500),
  })
  .strict();

export type SkillIndexEntry = z.infer<typeof skill_index_entry_schema>;
export type SkillIndex = z.infer<typeof skill_index_schema>;

export const empty_skill_index: SkillIndex = {
  skill_index_version,
  compiled_time: new Date(0).toISOString(),
  entries: [],
};

/**
 * What a procedure offers when the index cannot say. Shown in the discovery block and in
 * WORKSPACE.md, so the two surfaces describe the same procedure the same way.
 */
export const unindexed_skill_hint = 'Not in the index yet. Load it to read what it does.';

/**
 * An index built from the procedure folders alone, for when the compiled one is missing or
 * unreadable. It carries the slugs and nothing else, because nothing else can be known without
 * opening each SKILL.md — and the slug is enough for the model to load the right one.
 *
 * A workspace with procedures it cannot advertise is the failure this exists to prevent: one workspace
 * held four and offered none, so the model wrote a fifth that duplicated one of them.
 */
export function skill_index_from_procedure_folders(
  skill_slugs: readonly string[],
  procedures_folder: string,
): SkillIndex {
  return {
    skill_index_version,
    compiled_time: new Date(0).toISOString(),
    entries: [...skill_slugs].sort().map((skill_slug) => ({
      skill_slug,
      skill_name: skill_slug,
      skill_hint: unindexed_skill_hint,
      body_path: `${procedures_folder}/${skill_slug}/${skill_file_name}`,
      content_hash: 'not-compiled',
      preloaded_tool_keys: [],
      available_on_source_types: null,
    })),
  };
}

export type SkillIndexReadFailure = {
  reason: 'unreadable' | 'malformed' | 'version_too_new';
  detail: string;
};

/**
 * Reads a compiled index. Returns the failure rather than throwing: a workspace whose index is
 * missing or broken still gets its run, with the platform skills it always had.
 */
export function read_skill_index(
  index_text: string,
): { ok: true; index: SkillIndex } | { ok: false; failure: SkillIndexReadFailure } {
  let raw: unknown;
  try {
    raw = JSON.parse(index_text);
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: 'malformed',
        detail: format_error_message(error),
      },
    };
  }

  const parsed = skill_index_schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      failure: { reason: 'malformed', detail: parsed.error.issues[0]?.message ?? 'unknown' },
    };
  }
  if (parsed.data.skill_index_version > skill_index_version) {
    return {
      ok: false,
      failure: {
        reason: 'version_too_new',
        detail: `index is version ${parsed.data.skill_index_version}, this deploy reads ${skill_index_version}`,
      },
    };
  }
  return { ok: true, index: parsed.data };
}

export function serialize_skill_index(index: SkillIndex) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** The human-readable twin of the index, written next to it as index.md. */
export function format_skill_index_page(index: SkillIndex) {
  const lines = ['# skills', '', 'How the agent works. One folder per procedure.', ''];
  if (index.entries.length === 0) {
    lines.push('_Nothing here yet._');
  } else {
    for (const entry of index.entries) {
      lines.push(`- [${entry.skill_slug}](${entry.skill_slug}/SKILL.md) — ${entry.skill_hint}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
