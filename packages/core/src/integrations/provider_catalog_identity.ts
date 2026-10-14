import { createHash } from 'node:crypto';
import { catalog_app_name_max_length, normalize_machine_name } from '@coworker/shared';

type ProviderNodeConfig = Record<string, unknown> & {
  sourced_from?: Record<string, unknown> & { provider_component_id?: string };
};

type ProviderNodeSeedIdentity = {
  node_name: string;
  node_config: ProviderNodeConfig;
};

export type ExistingProviderNodeIdentity = {
  node_name: string;
  node_version: number;
  node_config: ProviderNodeConfig;
};

export function build_provider_app_names(
  provider_app_slugs: string[],
  reserved_app_names: ReadonlySet<string>,
  options: { collision_prefix: string },
) {
  const identities = provider_app_slugs.map((provider_app_slug) => {
    const normalized_slug = normalize_machine_name(provider_app_slug, {
      maximum_length: Number.MAX_SAFE_INTEGER,
      fallback: 'app',
    });
    const candidate = reserved_app_names.has(normalized_slug)
      ? `${options.collision_prefix}${normalized_slug}`
      : normalized_slug;
    return {
      provider_app_slug,
      candidate,
      normalization_is_lossy: normalized_slug !== provider_app_slug.toLowerCase(),
      candidate_collides_with_reserved: reserved_app_names.has(candidate),
    };
  });
  const candidate_counts = count_values(identities.map((identity) => identity.candidate));
  const app_names = new Map<string, string>();
  const provider_slug_by_app_name = new Map<string, string>();

  for (const identity of identities) {
    const needs_suffix =
      identity.normalization_is_lossy ||
      identity.candidate_collides_with_reserved ||
      identity.candidate.length > catalog_app_name_max_length ||
      (candidate_counts.get(identity.candidate) ?? 0) > 1;
    const app_name = needs_suffix
      ? append_stable_suffix(identity.candidate, identity.provider_app_slug)
      : identity.candidate;
    const existing_slug = provider_slug_by_app_name.get(app_name);
    if (existing_slug) {
      throw new Error(
        `Provider app identity collision: ${existing_slug} and ${identity.provider_app_slug}`,
      );
    }
    app_names.set(identity.provider_app_slug, app_name);
    provider_slug_by_app_name.set(app_name, identity.provider_app_slug);
  }

  return app_names;
}

export function preserve_provider_node_names<T extends ProviderNodeSeedIdentity>(
  seeds: T[],
  existing_nodes: ExistingProviderNodeIdentity[],
) {
  const existing_by_component_id = index_existing_nodes_by_component_id(existing_nodes);
  const existing_by_name = new Map(existing_nodes.map((node) => [node.node_name, node]));
  const incoming_component_ids = new Set<string>();
  const incoming_component_by_name = new Map<string, string>();

  return seeds.map((seed) => {
    const provider_component_id = read_provider_component_id(seed.node_config);
    if (!provider_component_id) {
      throw new Error(`Provider node seed is missing provider_component_id: ${seed.node_name}`);
    }
    if (incoming_component_ids.has(provider_component_id)) {
      throw new Error(`Duplicate provider component: ${provider_component_id}`);
    }
    incoming_component_ids.add(provider_component_id);

    const node_name =
      existing_by_component_id.get(provider_component_id)?.node_name ?? seed.node_name;
    reject_node_name_rebinding(node_name, provider_component_id, existing_by_name);

    const incoming_component_id = incoming_component_by_name.get(node_name);
    if (incoming_component_id) {
      throw new Error(
        `Provider components ${incoming_component_id} and ${provider_component_id} resolve to node_name ${node_name}`,
      );
    }
    incoming_component_by_name.set(node_name, provider_component_id);

    return node_name === seed.node_name ? seed : { ...seed, node_name };
  });
}

export function fit_node_name(
  node_name: string,
  provider_component_id: string,
  maximum_length: number,
) {
  if (node_name.length <= maximum_length) return node_name;
  if (maximum_length < 10) {
    throw new Error(`node_name maximum is too short for a collision suffix: ${maximum_length}`);
  }
  return append_hash_suffix(node_name, provider_component_id, maximum_length);
}

export function append_hash_suffix(name: string, seed: string, maximum_length: number) {
  const suffix = createHash('md5').update(seed).digest('hex').slice(0, 8);
  return `${name.slice(0, maximum_length - 9)}_${suffix}`;
}

function index_existing_nodes_by_component_id(existing_nodes: ExistingProviderNodeIdentity[]) {
  const nodes_by_component_id = new Map<string, ExistingProviderNodeIdentity>();
  for (const node of existing_nodes) {
    const provider_component_id = read_provider_component_id(node.node_config);
    if (!provider_component_id) continue;
    const existing = nodes_by_component_id.get(provider_component_id);
    if (existing && existing.node_name !== node.node_name) {
      throw new Error(
        `Provider component ${provider_component_id} is bound to both ${existing.node_name} and ${node.node_name}`,
      );
    }
    nodes_by_component_id.set(provider_component_id, node);
  }
  return nodes_by_component_id;
}

function reject_node_name_rebinding(
  node_name: string,
  provider_component_id: string,
  existing_by_name: Map<string, ExistingProviderNodeIdentity>,
) {
  const existing = existing_by_name.get(node_name);
  if (!existing) return;
  const existing_component_id = read_provider_component_id(existing.node_config);
  if (existing_component_id === provider_component_id) return;
  throw new Error(
    `Refusing to rebind node_name ${node_name} from ${existing_component_id ?? 'unknown'} to ${provider_component_id}`,
  );
}

function read_provider_component_id(node_config: ProviderNodeConfig) {
  return node_config.sourced_from?.provider_component_id ?? null;
}

function append_stable_suffix(candidate: string, provider_app_slug: string) {
  return append_hash_suffix(candidate, provider_app_slug, catalog_app_name_max_length);
}

function count_values(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
