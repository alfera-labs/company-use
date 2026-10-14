import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const api_key_memory_scope_routes = create_hosted_business_routes([
  '/v1/api-keys/:api_key_id/memory-scopes',
  '/v1/api-keys/:api_key_id/memory-scopes/*',
]);
