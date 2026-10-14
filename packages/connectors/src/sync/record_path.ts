import type {
  ConnectorFolderListing,
  ConnectorParentChain,
  ConnectorPathSegment,
  ConnectorPathText,
  ConnectorRecordPath,
  FolderEntry,
  FolderMap,
} from '@connectors/sync/record_path_types';
import { evaluate_value_expression } from '@connectors/value_expression';
import { z } from 'zod';

const max_chain_depth = 50;
const path_separator = '/';

const path_text_schema = z.object({ text: z.unknown() }).loose();

function is_path_text(segment: ConnectorPathSegment): segment is ConnectorPathText {
  return path_text_schema.safeParse(segment).success;
}

function to_text_values(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((one) => typeof one === 'string' || typeof one === 'number')
    .map((one) => String(one));
}

export function clean_path_segment(name: string): string | null {
  const cleaned = name.replaceAll(path_separator, '-').replace(/\s+/gu, ' ').trim();
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') return null;
  return cleaned;
}

function split_name(name: string, separator: string | undefined): string[] {
  const parts = separator ? name.split(separator) : [name];
  return parts.map(clean_path_segment).filter((part): part is string => part !== null);
}

function read_path_text(segment: ConnectorPathText, scope: Record<string, unknown>): string[] {
  return to_text_values(evaluate_value_expression(segment.text, scope)).flatMap((value) => {
    const prefix = segment.strip_prefix;
    const stripped = prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
    return split_name(stripped, segment.split_on);
  });
}

export function read_fixed_path_segments(
  path: ConnectorRecordPath,
  scope: Record<string, unknown>,
): string[] {
  return (path.segments ?? []).flatMap((segment) =>
    is_path_text(segment)
      ? read_path_text(segment, scope)
      : to_text_values(evaluate_value_expression(segment, scope)).flatMap((value) =>
          split_name(value, undefined),
        ),
  );
}

const value_match_schema = z
  .object({ value_of: z.unknown(), is_one_of: z.array(z.unknown()).min(1) })
  .strict();

export function read_value_condition(condition: unknown, scope: Record<string, unknown>): boolean {
  const match = value_match_schema.safeParse(condition);
  if (!match.success) return evaluate_value_expression(condition, scope) === true;
  return match.data.is_one_of.includes(evaluate_value_expression(match.data.value_of, scope));
}

function read_folder_entry(
  listing: ConnectorFolderListing,
  item: unknown,
): [string, FolderEntry] | null {
  const scope = { item };
  if (listing.when !== undefined && !read_value_condition(listing.when, scope)) return null;
  const [id] = to_text_values(evaluate_value_expression(listing.id, scope));
  const [name] = to_text_values(evaluate_value_expression(listing.name, scope));
  if (!id || name === undefined) return null;
  const parent_ids = listing.parent_id
    ? to_text_values(evaluate_value_expression(listing.parent_id, scope))
    : [];
  return [id, { name, parent_id: parent_ids[0] ?? null }];
}

export function build_folder_map(
  listing: ConnectorFolderListing,
  items: readonly unknown[],
): FolderMap {
  const entries = items
    .map((item) => read_folder_entry(listing, item))
    .filter((entry): entry is [string, FolderEntry] => entry !== null);
  return new Map(entries);
}

function walk_up_from(folder_id: string, folders: FolderMap): FolderEntry[] {
  const chain: FolderEntry[] = [];
  const visited = new Set<string>();
  let current: string | null = folder_id;
  while (current !== null && !visited.has(current) && chain.length < max_chain_depth) {
    const folder = folders.get(current);
    if (!folder) break;
    visited.add(current);
    chain.unshift(folder);
    current = folder.parent_id;
  }
  return chain;
}

export function resolve_parent_chain(
  chain: ConnectorParentChain,
  scope: Record<string, unknown>,
  folders: FolderMap,
): string[] {
  const parent_ids = to_text_values(evaluate_value_expression(chain.parent_ids, scope));
  if (parent_ids.length === 0 && chain.no_parent_name) {
    return split_name(chain.no_parent_name, undefined);
  }
  const listed_parent = parent_ids.find((id) => folders.has(id));
  if (listed_parent !== undefined) {
    return walk_up_from(listed_parent, folders).flatMap((folder) =>
      split_name(folder.name, chain.name_separator),
    );
  }
  const known_parent = parent_ids.find((id) => chain.known_names?.[id] !== undefined);
  if (known_parent !== undefined)
    return split_name(chain.known_names?.[known_parent] ?? '', undefined);
  return chain.root_name ? split_name(chain.root_name, undefined) : [];
}

export function join_path_segments(segments: readonly string[]): string | null {
  return segments.length > 0 ? segments.join(path_separator) : null;
}
