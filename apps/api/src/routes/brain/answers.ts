import { create_hosted_business_routes } from '@api/lib/hosted_business_routes';

export const brain_answer_routes = create_hosted_business_routes(['/v1/answers', '/v1/answers/*']);
