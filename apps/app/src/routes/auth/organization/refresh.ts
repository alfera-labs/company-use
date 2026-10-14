import { createFileRoute } from '@tanstack/react-router';
import { refresh_organization } from '@/lib/organization_refresh';

export const Route = createFileRoute('/auth/organization/refresh')({
  server: { handlers: { GET: ({ request }) => refresh_organization(request) } },
});
