import { define_connector_execute } from '@connectors/define_connector_execute';
import type { JsonSchema } from '@coworker/shared';

type CollectItemsInput = { item_ids: string[] };
type CollectItemsOutput = {
  items: { id: string; text: string }[];
  failures: { index: number; message: string }[];
};

const item_response_schema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, value: { type: 'string' } },
  required: ['id', 'value'],
};

export const execute = define_connector_execute<CollectItemsInput, CollectItemsOutput>(
  async (input, context) => {
    const results = await context.fan_out({
      items: input.item_ids,
      limits: context.app.rate_limits,
      call_one: (item_id) =>
        context.send_request<{ id: string; value: string }>({
          method: 'GET',
          path: `/items/${encodeURIComponent(item_id)}`,
          response_schema: item_response_schema,
        }),
    });

    const items: CollectItemsOutput['items'] = [];
    const failures: CollectItemsOutput['failures'] = [];
    for (const result of results) {
      if (result.ok) items.push({ id: result.data.id, text: result.data.value });
      else failures.push({ index: result.index, message: result.error.message });
    }
    return { items, failures };
  },
);
