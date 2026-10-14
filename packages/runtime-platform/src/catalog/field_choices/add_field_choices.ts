import type { LlmGateway } from '@agent-core/llm_gateway';
import type {
  NodeConfigData,
  TriggerFieldChoiceSource,
} from '@coworker/core/db/schema/json_column_types';
import {
  ask_for_field_choices,
  keep_what_was_shown,
} from '@runtime-platform/catalog/field_choices/ask_for_field_choices';
import {
  collect_field_choice_candidates,
  fingerprint_candidates,
} from '@runtime-platform/catalog/field_choices/field_choice_candidates';
import {
  read_stored_field_choices,
  type StoredFieldChoices,
} from '@runtime-platform/catalog/field_choices/stored_field_choices';
import { z } from 'zod';

type Seed = {
  node_kind: string;
  node_name: string;
  input_schema: unknown;
  output_schema?: unknown;
  metadata?: unknown;
  node_config: NodeConfigData;
};
type Aliases = Record<string, TriggerFieldChoiceSource>;
export type FieldChoicesOutcome = 'asked' | 'reused' | 'nothing_to_map' | 'kept_previous';

export async function add_field_choices<S extends Seed>(input: {
  app_display_name: string;
  seeds: S[];
  existing_node_configs: unknown[];
  ask: boolean;
  gateway?: LlmGateway;
}): Promise<{ seeds: S[]; outcome: FieldChoicesOutcome }> {
  const candidates = collect_field_choice_candidates(input.seeds);
  const fingerprint = fingerprint_candidates(candidates);
  const stored = input.existing_node_configs
    .map(read_stored_field_choices)
    .filter((found): found is StoredFieldChoices => found !== null);
  const same = stored.filter((found) => found.fingerprint === fingerprint);

  if (same.length > 0) {
    return done(input.seeds, fingerprint, recheck(union(same), candidates), 'reused');
  }
  if (candidates.fields.length === 0 || candidates.actions.length === 0) {
    return done(input.seeds, fingerprint, {}, 'nothing_to_map');
  }
  if (!input.ask) {
    const previous = stored[0];
    if (!previous) return { seeds: input.seeds, outcome: 'kept_previous' };
    return done(input.seeds, previous.fingerprint, union(stored), 'kept_previous');
  }
  const aliases = await ask_for_field_choices(
    { app_display_name: input.app_display_name, candidates },
    input.gateway,
  );
  return done(input.seeds, fingerprint, aliases, 'asked');
}

function recheck(aliases: Aliases, candidates: Parameters<typeof keep_what_was_shown>[1]): Aliases {
  return keep_what_was_shown(
    Object.entries(aliases).map(([field, source]) => ({
      field,
      action: source.action_node_name,
      items_path: [...source.items_path],
      value_path: [...source.value_path],
      label_path: [...source.label_path],
    })),
    candidates,
  );
}

function union(stored: StoredFieldChoices[]): Aliases {
  return Object.assign({}, ...stored.map((found) => found.fields));
}

function done<S extends Seed>(
  seeds: S[],
  fingerprint: string,
  aliases: Aliases,
  outcome: FieldChoicesOutcome,
) {
  return { seeds: seeds.map((seed) => write_own_slice(seed, fingerprint, aliases)), outcome };
}

const properties_schema = z
  .object({ properties: z.record(z.string(), z.unknown()) })
  .catch({ properties: {} });

function write_own_slice<S extends Seed>(seed: S, fingerprint: string, aliases: Aliases): S {
  if (seed.node_kind !== 'trigger') return seed;
  const own = Object.fromEntries(
    Object.keys(properties_schema.parse(seed.input_schema).properties).flatMap((name) => {
      const alias = aliases[name];
      return alias ? [[name, alias]] : [];
    }),
  );
  return {
    ...seed,
    node_config: { ...seed.node_config, field_choices: { fingerprint, fields: own } },
  };
}
