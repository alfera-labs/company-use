import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const admin_billing_routes = create_hosted_business_routes(['/v1/admin/billing/*']);
