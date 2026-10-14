import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix, relative, sep } from 'node:path';
import {
  type AlferaSidecar,
  alfera_sidecar_schema,
  type BundleFile,
  type BundleManifest,
  bundle_byte_limit,
  type FileRole,
  inline_text_byte_limit,
} from '@coworker/core/templates/template_object';
import { ValidationError } from '@coworker/shared';
import { parse as parse_yaml } from 'yaml';
import { z } from 'zod';

const skill_markdown_file = 'SKILL.md';
const sidecar_file = 'alfera.json';

/**
 * The six keys the standard allows. We read them; we do not reject the rest — most real
 * SKILL.md files carry harness-specific keys like `version` and `triggers`, and a
 * parser that errored on those would import almost nothing from the ecosystem.
 */
const skill_frontmatter_schema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  'allowed-tools': z.union([z.array(z.string()), z.string()]).optional(),
});

type SkillFrontmatter = z.infer<typeof skill_frontmatter_schema>;

export type SkillFolder = {
  folder_name: string;
  frontmatter: SkillFrontmatter;
  instruction_markdown: string;
  discovery_phrases: string[];
  allowed_tools: string[];
  sidecar: AlferaSidecar | null;
  manifest: BundleManifest;
  bundled_skills: SkillFolder[];
};

const slug_pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function validate_skill_name(name: string, folder_name: string) {
  if (name.length < 1 || name.length > 64) {
    throw new ValidationError(`Skill name "${name}" must be 1 to 64 characters.`);
  }
  if (!slug_pattern.test(name)) {
    throw new ValidationError(
      `Skill name "${name}" must be lowercase letters, digits and single hyphens.`,
    );
  }
  if (name !== folder_name) {
    throw new ValidationError(
      `Skill name "${name}" must equal its directory name "${folder_name}".`,
    );
  }
  const lowered = name.toLowerCase();
  if (lowered.includes('anthropic') || lowered.includes('claude')) {
    throw new ValidationError(`Skill name "${name}" must not contain a vendor name.`);
  }
  return name;
}

/** Splits `---`-delimited YAML frontmatter from the markdown body. */
export function parse_skill_markdown(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) {
    throw new ValidationError('SKILL.md must start with a --- delimited frontmatter block.');
  }
  const parsed_yaml = parse_yaml(match[1] ?? '') as unknown;
  if (parsed_yaml === null || typeof parsed_yaml !== 'object' || Array.isArray(parsed_yaml)) {
    throw new ValidationError('SKILL.md frontmatter must be a mapping of keys to values.');
  }
  return {
    frontmatter: skill_frontmatter_schema.parse(parsed_yaml),
    body: (match[2] ?? '').trim(),
  };
}

function read_skill_folder(folder_path: string): SkillFolder {
  const folder_name = basename(folder_path);
  const markdown_path = join(folder_path, skill_markdown_file);
  const { frontmatter, body } = parse_skill_markdown(read_utf8_file(markdown_path));
  validate_skill_name(frontmatter.name, folder_name);

  const sidecar = read_sidecar(folder_path);
  const files = collect_files(folder_path);
  const manifest = build_manifest(files);
  if (manifest.total_bytes > bundle_byte_limit) {
    throw new ValidationError(
      `Folder "${folder_name}" is ${manifest.total_bytes} bytes, over the ${bundle_byte_limit} byte cap.`,
    );
  }

  return {
    folder_name,
    frontmatter,
    instruction_markdown: body,
    discovery_phrases: read_discovery_phrases(frontmatter),
    allowed_tools: read_allowed_tools(frontmatter),
    sidecar,
    manifest,
    bundled_skills: read_bundled_skills(folder_path),
  };
}

/** Every folder directly under a library directory, in slug order. */
export function read_library_folders(library_path: string): SkillFolder[] {
  return readdirSync(library_path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => read_skill_folder(join(library_path, name)));
}

function read_sidecar(folder_path: string): AlferaSidecar | null {
  const sidecar_path = join(folder_path, sidecar_file);
  if (!file_exists(sidecar_path)) return null;
  return alfera_sidecar_schema.parse(JSON.parse(read_utf8_file(sidecar_path)));
}

function read_bundled_skills(folder_path: string): SkillFolder[] {
  const nested_path = join(folder_path, 'skills');
  if (!directory_exists(nested_path)) return [];
  return read_library_folders(nested_path);
}

/**
 * Invocation phrases, from either place a real skill puts them.
 *
 * Third-party folders use a top-level `triggers:` — 95 of the 100 real SKILL.md files in this
 * repo do — so we read it. Our own folders put the same list under `metadata:`, because a
 * top-level key outside the standard's six is a HARD ERROR on claude.ai upload and in the Skills
 * API, and a folder we cannot upload fails the compatibility the whole format choice is for.
 */
function read_discovery_phrases(frontmatter: SkillFrontmatter): string[] {
  return [
    ...read_phrase_list(frontmatter.triggers),
    ...read_phrase_list(frontmatter.metadata?.triggers),
  ];
}

function read_phrase_list(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (phrase): phrase is string => typeof phrase === 'string' && phrase.length > 0,
  );
}

function read_allowed_tools(frontmatter: SkillFrontmatter): string[] {
  const value = frontmatter['allowed-tools'];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean);
  }
  return value ?? [];
}

type CollectedFile = { relative_path: string; bytes: Buffer };

function collect_files(folder_path: string): CollectedFile[] {
  const collected: CollectedFile[] = [];
  walk(folder_path, folder_path, collected);
  return collected.sort(
    (left, right) =>
      root_file_rank(left.relative_path) - root_file_rank(right.relative_path) ||
      left.relative_path.localeCompare(right.relative_path),
  );
}

function root_file_rank(relative_path: string) {
  if (relative_path === skill_markdown_file) return 0;
  if (relative_path === sidecar_file) return 1;
  return 2;
}

function walk(root: string, directory: string, collected: CollectedFile[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entry_path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === root && entry.name === 'skills') continue;
      walk(root, entry_path, collected);
      continue;
    }
    if (!entry.isFile()) continue;
    collected.push({
      relative_path: relative(root, entry_path).split(sep).join(posix.sep),
      bytes: readFileSync(entry_path),
    });
  }
}

function build_manifest(files: CollectedFile[]): BundleManifest {
  const manifest_files = files.map(to_bundle_file);
  return {
    manifest_version: 1,
    file_count: manifest_files.length,
    total_bytes: manifest_files.reduce((total, file) => total + file.byte_size, 0),
    files: manifest_files,
  };
}

function to_bundle_file(file: CollectedFile): BundleFile {
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const base: BundleFile = {
    file_path: file.relative_path,
    file_role: classify_file(file.relative_path),
    byte_size: file.bytes.byteLength,
    sha256,
  };
  const text = decode_text(file.bytes);
  if (text !== null && file.bytes.byteLength <= inline_text_byte_limit) {
    return { ...base, inline_text: text };
  }
  return { ...base, storage_key: `pending:${sha256}` };
}

function classify_file(relative_path: string): FileRole {
  if (relative_path === skill_markdown_file) return 'instructions';
  if (relative_path === sidecar_file) return 'sidecar';
  if (relative_path.endsWith('/SKILL.md')) return 'bundled_skill';
  if (/\.(?:py|sh|js|ts|rb|pl)$/u.test(relative_path)) return 'script';
  if (/\.(?:md|markdown|txt|csv|json|ya?ml)$/u.test(relative_path)) return 'reference';
  return 'asset';
}

function decode_text(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
}

function read_utf8_file(file_path: string) {
  try {
    return readFileSync(file_path, 'utf8');
  } catch {
    throw new ValidationError(`Missing required file ${file_path}.`);
  }
}

function file_exists(file_path: string) {
  try {
    return statSync(file_path).isFile();
  } catch {
    return false;
  }
}

function directory_exists(directory_path: string) {
  try {
    return statSync(directory_path).isDirectory();
  } catch {
    return false;
  }
}
