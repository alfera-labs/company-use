import { get_connector_node } from '@connectors/registry';
import type { JsonSchema } from '@coworker/shared';

export type ConnectorNodeSchema = {
  node_key: string;
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
};

export function get_node_schema(node_key: string): ConnectorNodeSchema | null {
  const registered = get_connector_node(node_key);
  if (!registered) return null;
  return {
    node_key: registered.node_key,
    description: registered.node.description,
    input_schema: registered.node.input_schema,
    output_schema: registered.node.output_schema,
  };
}
