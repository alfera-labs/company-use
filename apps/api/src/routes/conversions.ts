import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const public_conversion_routes = create_hosted_business_routes(['/public/conversions/*']);
