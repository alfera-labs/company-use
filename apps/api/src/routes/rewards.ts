import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const rewards_routes = create_hosted_business_routes(['/v1/rewards', '/v1/rewards/*']);
