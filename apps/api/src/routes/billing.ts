import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const billing_routes = create_hosted_business_routes([
  '/v1/billing',
  '/v1/billing/*',
  '/v1/usage',
  '/v1/usage/*',
]);
