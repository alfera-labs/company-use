import type { ConnectorExecute } from '@connectors/types';

export function define_connector_execute<TInput, TOutput>(
  execute: ConnectorExecute<TInput, TOutput>,
): ConnectorExecute {
  return (input, context) => execute(input as TInput, context);
}
