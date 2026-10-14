import { ConnectorHttpError } from '@connectors/runtime/http_request';
import type {
  ConnectorError,
  ConnectorFanOutInput,
  ConnectorFanOutItemResult,
} from '@connectors/types';
import { format_error_message } from '@coworker/shared';

export function as_connector_error(error: unknown): ConnectorError {
  if (error instanceof ConnectorHttpError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: 'node_failed',
    message: format_error_message(error),
    retryable: false,
  };
}

export async function fan_out<TItem, TResult>(
  input: ConnectorFanOutInput<TItem, TResult>,
): Promise<ConnectorFanOutItemResult<TResult>[]> {
  const results: ConnectorFanOutItemResult<TResult>[] = new Array(input.items.length);
  const worker_count = Math.min(Math.max(1, input.limits.concurrency), input.items.length);
  let next_index = 0;

  async function run_next_items() {
    while (next_index < input.items.length) {
      const index = next_index;
      next_index += 1;
      const item = input.items[index] as TItem;
      try {
        results[index] = { ok: true, index, data: await input.call_one(item, index) };
      } catch (error) {
        if (input.atomic) throw error;
        results[index] = { ok: false, index, error: as_connector_error(error) };
      }
    }
  }

  await Promise.all(Array.from({ length: worker_count }, () => run_next_items()));
  return results;
}
