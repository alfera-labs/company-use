import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const member_link_routes = create_hosted_business_routes([
  '/v1/member-links',
  '/v1/member-links/*',
]);
