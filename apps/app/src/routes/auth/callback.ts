import { createFileRoute } from '@tanstack/react-router';
import { workos_auth_callback } from '@/lib/workos_auth_routes';

export const Route = createFileRoute('/auth/callback')({
  server: { handlers: { GET: ({ request }) => workos_auth_callback(request) } },
});
