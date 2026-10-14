import type { LinkFamily } from '@connectors/relation_families';
import {
  join_path_segments,
  read_fixed_path_segments,
  read_value_condition,
} from '@connectors/sync/record_path';
import { expression_text, to_content_text } from '@connectors/sync/record_text';
import { to_bucket_day } from '@connectors/sync/sync_markers';
import { resolve_app_relation } from '@connectors/sync_definition/relationship_schema';
import { is_read_content, is_scope_day_of } from '@connectors/sync_definition/sync_object_schema';
import type { ConnectorSyncFile, ConnectorSyncObject } from '@connectors/sync_types';
import type { ConnectorApp } from '@connectors/types';
import { evaluate_value_expression } from '@connectors/value_expression';
import { z } from 'zod';

const sync_file_schema = z.object({ id: z.string().min(1), name: z.string() }).loose();

export type SyncScopeValue = { id: string; label: string };

export type MappedSyncLink = {
  relation: string;
  link_family: LinkFamily;
  to: string;
};

export type MappedSyncRecord = {
  external_item_id: string;
  title: string;
  item_kind: string;
  content_text: string | null;
  external_revision: string | null;
  source_url: string | null;
  external_container_id: string | null;
  container_path: string | null;
  tombstoned: boolean;
  cursor_value: string | null;
  bucket_key: string | null;
  bucket_day: string | null;
  links: readonly MappedSyncLink[];
  files: readonly ConnectorSyncFile[];
  metadata: Record<string, unknown>;
};

export function record_is_wanted(
  recipe: ConnectorSyncObject,
  input: { item: unknown; scope: SyncScopeValue },
): boolean {
  if (recipe.when === undefined) return true;
  return Boolean(evaluate_value_expression(recipe.when, { item: input.item, scope: input.scope }));
}

function read_identity(recipe: ConnectorSyncObject, scope: Record<string, unknown>): string {
  const identity = evaluate_value_expression(recipe.identity, scope);
  if (identity === undefined || identity === null || String(identity).length === 0) {
    throw new Error('A sync object`s identity must read a value out of every record.');
  }
  return String(identity);
}

function read_tombstone(tombstone: unknown, scope: Record<string, unknown>): boolean {
  if (tombstone === undefined) return false;
  return read_value_condition(tombstone, scope);
}

function read_container_path(
  recipe: ConnectorSyncObject,
  scope: Record<string, unknown>,
): string | null {
  if (recipe.path) return join_path_segments(read_fixed_path_segments(recipe.path, scope));
  return recipe.container?.path
    ? expression_text(evaluate_value_expression(recipe.container.path, scope))
    : null;
}

function read_record_text_fields(
  recipe: ConnectorSyncObject,
  scope: Record<string, unknown>,
  identity: string,
) {
  return {
    title: expression_text(evaluate_value_expression(recipe.title, scope)) ?? identity,
    content_text: is_read_content(recipe.content)
      ? null
      : to_content_text(evaluate_value_expression(recipe.content, scope)),
    external_revision: recipe.version_signal
      ? expression_text(evaluate_value_expression(recipe.version_signal, scope))
      : null,
    source_url: recipe.source_url
      ? expression_text(evaluate_value_expression(recipe.source_url, scope))
      : null,
    container_path: read_container_path(recipe, scope),
    tombstoned: read_tombstone(recipe.tombstone, scope),
  };
}

export function map_sync_record(
  app: ConnectorApp,
  recipe: ConnectorSyncObject,
  input: { item: unknown; scope: SyncScopeValue },
): MappedSyncRecord {
  const scope = { item: input.item, scope: input.scope };
  const identity = read_identity(recipe, scope);
  const cursor_value = recipe.cursor
    ? expression_text(evaluate_value_expression(recipe.cursor.field, scope))
    : null;
  const external_container_id = recipe.container
    ? expression_text(evaluate_value_expression(recipe.container.id, scope))
    : null;
  const bucket_day =
    recipe.bucket?.by === 'day'
      ? to_bucket_day(evaluate_value_expression(recipe.bucket.of, scope))
      : null;

  return {
    external_item_id: identity,
    item_kind: recipe.item_kind,
    ...read_record_text_fields(recipe, scope, identity),
    external_container_id,
    cursor_value,
    bucket_key: read_bucket_key(recipe, scope, {
      external_container_id,
      bucket_day,
      scope_id: input.scope.id,
    }),
    bucket_day,
    links: read_links(app, recipe, scope, input.scope),
    files: read_record_files(recipe, scope),
    metadata: read_record_metadata(recipe, scope),
  };
}

function read_bucket_key(
  recipe: ConnectorSyncObject,
  scope: Record<string, unknown>,
  parts: { external_container_id: string | null; bucket_day: string | null; scope_id: string },
): string | null {
  if (!recipe.bucket) return null;
  if (recipe.bucket.by === 'day') {
    return parts.bucket_day ? `${parts.external_container_id ?? ''}:${parts.bucket_day}` : null;
  }
  const key = expression_text(evaluate_value_expression(recipe.bucket.key, scope));
  if (!key || key.length === 0) return null;
  return recipe.bucket.scoped ? `${parts.scope_id}:${key}` : key;
}

function read_links(
  app: ConnectorApp,
  recipe: ConnectorSyncObject,
  scope: Record<string, unknown>,
  scope_value: SyncScopeValue,
): MappedSyncLink[] {
  return Object.entries(recipe.relationships ?? {}).flatMap(([relation, expression]) => {
    const link_family = resolve_app_relation(app, relation).link_family;
    if (is_scope_day_of(expression)) {
      const day = to_bucket_day(evaluate_value_expression(expression.scope_day_of, scope));
      return day ? [{ relation, link_family, to: `${scope_value.id}:${day}` }] : [];
    }
    const value = evaluate_value_expression(expression, scope);
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .filter((id): id is string | number => id !== undefined && id !== null && id !== '')
      .map((id) => ({ relation, link_family, to: String(id) }));
  });
}

function read_record_files(
  recipe: ConnectorSyncObject,
  scope: Record<string, unknown>,
): ConnectorSyncFile[] {
  if (!recipe.files) return [];
  const value = evaluate_value_expression(recipe.files, scope);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ConnectorSyncFile => sync_file_schema.safeParse(entry).success,
  );
}

function read_record_metadata(recipe: ConnectorSyncObject, scope: Record<string, unknown>) {
  const metadata: Record<string, unknown> = {};
  for (const [key, expression] of Object.entries(recipe.metadata ?? {})) {
    const value = evaluate_value_expression(expression, scope);
    if (value === undefined || value === null) continue;
    metadata[key] = value;
  }
  return metadata;
}
