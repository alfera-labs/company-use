import { composio_proxy_runtime_handler } from '@coworker/core/integrations/composio_schema';

export const api_proxy_runtime_handlers = [composio_proxy_runtime_handler] as const;

export function is_api_proxy_runtime_handler(runtime_handler: string): boolean {
  return api_proxy_runtime_handlers.some((handler) => handler === runtime_handler);
}
