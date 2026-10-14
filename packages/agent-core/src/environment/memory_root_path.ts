import path from 'node:path';
import { workspace_path_escape_message } from '@agent-core/environment/workspace_path_escape';
import { z } from 'zod';

/** Where narrow memory scopes live for the model: `/memory/<scope slug>/...` on sandbox-local disk. */
export const memory_root_model_path = '/memory';

/** The root-level listing of this run's open scopes. Not inside any scope folder, so every run may write it. */
export const memory_root_index_path = `${memory_root_model_path}/index.md`;

/** The session environment metadata key that carries the scope slugs this run may open. */
export const memory_root_open_slugs_key = 'memory_root_open_slugs';

const open_slugs_schema = z.array(z.string().min(1));

/** Every model root the host can route a path to. Add a name here to add a root. */
export const model_root_names = ['memory', 'workspace'] as const;

export type ModelRootName = (typeof model_root_names)[number];

export type ModelRootRecord = {
  readonly name: ModelRootName;
  readonly path_matches: (normalized_path: string) => boolean;
};

const memory_root_record: ModelRootRecord = {
  name: 'memory',
  path_matches: (normalized_path) =>
    normalized_path === memory_root_model_path ||
    normalized_path.startsWith(`${memory_root_model_path}/`),
};

const workspace_root_record: ModelRootRecord = {
  name: 'workspace',
  path_matches: () => true,
};

const model_root_records: readonly ModelRootRecord[] = [memory_root_record, workspace_root_record];

/** The record for the root a model path names, after normalization. The catch-all always matches. */
export function model_root_of(given_path: string): ModelRootRecord {
  const normalized_path = path.posix.normalize(given_path);
  return (
    model_root_records.find((record) => record.path_matches(normalized_path)) ??
    workspace_root_record
  );
}

/** True for `/memory` and every absolute path under it, after normalization. */
export function is_memory_root_path(given_path: string) {
  return model_root_of(given_path).name === 'memory';
}

/** The first folder under `/memory`, or undefined for `/memory` itself and for other paths. */
export function open_scope_slug_of(given_path: string) {
  if (!is_memory_root_path(given_path)) return undefined;
  const [slug] = path.posix
    .normalize(given_path)
    .slice(memory_root_model_path.length + 1)
    .split('/');
  return slug || undefined;
}

/** The open slug set an environment carries. Missing or malformed metadata opens nothing. */
export function read_open_memory_slugs(metadata: Record<string, unknown> | undefined) {
  const parsed = open_slugs_schema.safeParse(metadata?.[memory_root_open_slugs_key]);
  return new Set<string>(parsed.success ? parsed.data : []);
}

/**
 * The path below the memory root (`<slug>/rest`) for a path whose slug is open.
 * A closed slug, a missing slug and `/memory` itself all throw the same escape message,
 * so the answer never tells a closed scope from one that does not exist.
 */
export function memory_root_relative_path(given_path: string, open_slugs: ReadonlySet<string>) {
  const normalized_path = path.posix.normalize(given_path);
  if (normalized_path === memory_root_index_path) {
    return normalized_path.slice(memory_root_model_path.length + 1);
  }
  const slug = open_scope_slug_of(given_path);
  if (slug === undefined || !open_slugs.has(slug)) {
    throw new Error(workspace_path_escape_message(given_path));
  }
  return normalized_path.slice(memory_root_model_path.length + 1);
}
