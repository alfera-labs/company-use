import { env } from '@coworker/config';
import type { ComposioNodeSeed } from '@coworker/core/integrations/composio_catalog';
import {
  add_field_choices,
  type FieldChoicesOutcome,
} from '@runtime-platform/catalog/field_choices/add_field_choices';

// The sync's field-choices step, with what a one-shot admin run needs around it: whether a model
// can be asked at all this run, and a failed call that costs the toolkit nothing — its nodes are
// written with whatever aliases were stored before, and the run says so.

export function can_ask_for_field_choices(args: string[]) {
  if (args.includes('--skip-field-choices')) return false;
  return Boolean(env.OPENAI_API_KEY || env.VERCEL_AI_GATEWAY_API_KEY || env.ANTHROPIC_API_KEY);
}

export async function add_field_choices_for_toolkit(input: {
  app_display_name: string;
  node_seeds: ComposioNodeSeed[];
  existing_node_configs: unknown[];
  ask: boolean;
  log: (event: string, fields: Record<string, unknown>) => void;
}): Promise<ComposioNodeSeed[]> {
  const request = {
    app_display_name: input.app_display_name,
    seeds: input.node_seeds,
    existing_node_configs: input.existing_node_configs,
  };
  try {
    const result = await add_field_choices({ ...request, ask: input.ask });
    log_outcome(input, result.outcome, result.seeds);
    return result.seeds;
  } catch (error) {
    input.log('field_choices_failed', {
      app: input.app_display_name,
      error: error instanceof Error ? error.message : String(error),
    });
    return (await add_field_choices({ ...request, ask: false })).seeds;
  }
}

function log_outcome(
  input: { app_display_name: string; log: (event: string, fields: Record<string, unknown>) => void },
  outcome: FieldChoicesOutcome,
  seeds: ComposioNodeSeed[],
) {
  if (outcome === 'nothing_to_map') return;
  const aliases = new Set(
    seeds.flatMap((seed) =>
      seed.node_kind === 'trigger'
        ? Object.entries(seed.node_config.field_choices?.fields ?? {}).map(
            ([field, source]) => `${field}→${source.action_node_name}`,
          )
        : [],
    ),
  );
  input.log('field_choices', { app: input.app_display_name, outcome, aliases: [...aliases] });
}
