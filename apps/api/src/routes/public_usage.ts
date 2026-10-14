import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const public_usage_routes = create_hosted_business_routes([
  '/v1/usage/summary',
  '/v1/usage/daily',
  '/v1/credits',
]);
