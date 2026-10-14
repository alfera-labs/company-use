// Refreshes the bundled models.dev snapshot the product ships. The API serves this snapshot until
// its first live fetch succeeds, the pi engine registers models from it (see pi_models.ts), and
// the www /models page is counted from it. Run after a lab ships a model:
//
//   bun run sync:models-dev
//
// Every provider keeps its id and name (the picker prints provider names from here). Only the
// providers a model proxy reaches keep their models, and only the models an agent can run: tool
// calling, text out, a context window, not retired. That keeps the file small enough to commit.
import { writeFileSync } from 'node:fs';
import {
  type ModelsDevModel,
  models_dev_catalog_schema,
} from '@agent-core/llm_gateway/models_dev_schema';
import { list_model_proxies } from '@coworker/shared';

const snapshot_path = 'packages/agent-core/src/llm_gateway/models_dev_snapshot.json';
const proxied_providers = new Set(list_model_proxies().map((proxy) => proxy.models_dev_provider_name));

const response = await fetch('https://models.dev/api.json', { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`models.dev returned status ${response.status}`);
const catalog = models_dev_catalog_schema.parse(await response.json());

const snapshot = Object.fromEntries(
  Object.entries(catalog).map(([provider_name, provider]) => [
    provider_name,
    {
      ...provider,
      models: proxied_providers.has(provider_name)
        ? Object.fromEntries(
            Object.entries(provider.models).filter(([, model]) => agents_can_run_this_model(model)),
          )
        : {},
    },
  ]),
);

function agents_can_run_this_model(model: ModelsDevModel) {
  return (
    model.tool_call === true &&
    model.modalities.output.includes('text') &&
    model.limit.context > 0 &&
    model.status !== 'deprecated'
  );
}

writeFileSync(snapshot_path, `${JSON.stringify(snapshot, null, 2)}\n`);
const model_count = Object.values(snapshot).reduce((n, p) => n + Object.keys(p.models).length, 0);
console.log(`wrote ${snapshot_path}: ${Object.keys(snapshot).length} providers, ${model_count} models`);
