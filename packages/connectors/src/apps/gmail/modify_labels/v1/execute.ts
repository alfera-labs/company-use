import node_definition from '@connectors/apps/gmail/modify_labels/v1/node.json' with {
  type: 'json',
};
import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type { ConnectorHttpMethod, ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type ModifyLabelsInput = {
  message_ids: string[];
  add_label_ids?: string[] | undefined;
  remove_label_ids?: string[] | undefined;
};

export type ModifyLabelsOutput = { modified_message_ids: string[] };

const endpoint = node_definition.quirks.endpoint;
const empty_response_schema = node_definition.response_schema as JsonSchema;

function is_empty_success(error: unknown) {
  return error instanceof ConnectorHttpError && error.status === 204;
}

export async function execute(
  input: ModifyLabelsInput,
  context: ConnectorNodeContext,
): Promise<ModifyLabelsOutput> {
  try {
    await context.send_request({
      method: endpoint.method as ConnectorHttpMethod,
      path: endpoint.path,
      body: {
        ids: input.message_ids,
        ...(input.add_label_ids ? { addLabelIds: input.add_label_ids } : {}),
        ...(input.remove_label_ids ? { removeLabelIds: input.remove_label_ids } : {}),
      },
      response_schema: empty_response_schema,
    });
  } catch (error) {
    if (!is_empty_success(error)) throw error;
  }
  return { modified_message_ids: input.message_ids };
}
