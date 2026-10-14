import { format_error_message } from '@coworker/shared';
import { z } from 'zod';

// The authored shape of a workspace procedure, and the strict parse that turns it into one.
//
// SKILL.md carries the open Agent Skills frontmatter and nothing else: the standard rejects an
// unknown key outright, so a file that would fail elsewhere must fail here too. Everything of
// ours rides in a sidecar next to it, alfera.json, which has its own strict schema.

export const skill_file_name = 'SKILL.md';
export const skill_sidecar_file_name = 'alfera.json';

const skill_frontmatter_schema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(1024),
    license: z.string().max(120).optional(),
    'allowed-tools': z.array(z.string().max(200)).max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    version: z.string().max(64).optional(),
  })
  .strict();

const skill_sidecar_schema = z
  .object({
    alfera_skill_version: z.literal(1),
    preloaded_tool_keys: z.array(z.string().min(1).max(200)).max(32).default([]),
    available_on_source_types: z.array(z.string().min(1).max(40)).max(16).nullable().default(null),
    origin: z
      .enum(['workspace_authored', 'agent_authored', 'installed', 'platform_example'])
      .default('workspace_authored'),
    installed_from_template_id: z.string().max(120).nullable().default(null),
  })
  .strict();

export type SkillSidecar = z.infer<typeof skill_sidecar_schema>;

export type ParsedSkillFile = {
  skill_name: string;
  description: string;
  body: string;
};

export class SkillFileError extends Error {
  readonly error_code = 'skill_file_invalid';
}

const frontmatter_pattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

/**
 * Parses a SKILL.md into its frontmatter and body. Throws SkillFileError with the reason, so
 * a compile can report which file is wrong rather than dropping it silently.
 */
export function parse_skill_file(file_text: string): ParsedSkillFile {
  const match = frontmatter_pattern.exec(file_text.replace(/^﻿/u, ''));
  if (!match) {
    throw new SkillFileError(
      'A skill must open with --- frontmatter carrying name and description.',
    );
  }
  const [, frontmatter_text = '', body = ''] = match;
  const parsed = skill_frontmatter_schema.safeParse(read_simple_yaml(frontmatter_text));
  if (!parsed.success) {
    throw new SkillFileError(
      `Skill frontmatter is not valid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'frontmatter'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return {
    skill_name: parsed.data.name,
    description: parsed.data.description,
    body: body.trim(),
  };
}

/** Parses alfera.json. A missing sidecar is legal and yields the defaults. */
export function parse_skill_sidecar(sidecar_text: string | undefined): SkillSidecar {
  if (!sidecar_text?.trim()) return skill_sidecar_schema.parse({ alfera_skill_version: 1 });
  let raw: unknown;
  try {
    raw = JSON.parse(sidecar_text);
  } catch (error) {
    throw new SkillFileError(
      `${skill_sidecar_file_name} is not valid JSON: ${format_error_message(error)}`,
    );
  }
  const parsed = skill_sidecar_schema.safeParse(raw);
  if (!parsed.success) {
    throw new SkillFileError(
      `${skill_sidecar_file_name} is not valid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'sidecar'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

function read_simple_yaml(frontmatter_text: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const line of frontmatter_text.split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const raw_value = line.slice(separator + 1).trim();
    if (!key) continue;
    values[key] = read_scalar_or_list(raw_value);
  }
  return values;
}

function read_scalar_or_list(raw_value: string): unknown {
  const unquoted = unquote(raw_value);
  if (!unquoted.startsWith('[') || !unquoted.endsWith(']')) return unquoted;
  const inner = unquoted.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => unquote(item.trim()));
}

function unquote(value: string) {
  if (value.length >= 2 && /^(['"]).*\1$/su.test(value)) return value.slice(1, -1);
  return value;
}
