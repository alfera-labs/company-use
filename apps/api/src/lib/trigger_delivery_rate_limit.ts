import type { ApiEnv } from '@api/lib/context';
import { AppError } from '@coworker/shared';
import type { MiddlewareHandler } from 'hono';

export const trigger_delivery_rate_window_ms = 60_000;
export const trigger_deliveries_per_window = 600;

// Counted in this process, like the open long-poll cap. With N API instances one trigger
// can take N times this many in a window; move the count onto the trigger row if that matters.
const delivery_counts_by_trigger = new Map<string, number>();
let counted_window = 0;

/**
 * One trigger's delivery address takes a fixed number of requests a minute, counted before the
 * trigger is read and before the body is. The window and the 429 answer are the ones an API key
 * gets. The count is by trigger, so a flood on one address never stops another.
 */
export function limit_trigger_delivery_rate(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const sent = count_trigger_delivery(c.req.param('trigger_id') ?? '');
    if (sent > trigger_deliveries_per_window) {
      const retry_after_seconds = Math.ceil(trigger_delivery_rate_window_ms / 1000);
      c.header('Retry-After', String(retry_after_seconds));
      throw new AppError('rate_limited', 'Rate limit exceeded. Retry in a moment.', 429, {
        retry_after_seconds,
      });
    }
    await next();
  };
}

function count_trigger_delivery(trigger_id: string): number {
  const window = Math.floor(Date.now() / trigger_delivery_rate_window_ms);
  if (window !== counted_window) {
    delivery_counts_by_trigger.clear();
    counted_window = window;
  }
  const sent = (delivery_counts_by_trigger.get(trigger_id) ?? 0) + 1;
  delivery_counts_by_trigger.set(trigger_id, sent);
  return sent;
}

export function forget_trigger_delivery_counts() {
  delivery_counts_by_trigger.clear();
}
