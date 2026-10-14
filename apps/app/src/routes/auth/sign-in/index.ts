import { createFileRoute } from '@tanstack/react-router';
import { redirect_to_workos_sign_in } from '@/lib/workos_auth_routes';

export const Route = createFileRoute('/auth/sign-in/')({
  server: { handlers: { GET: ({ request }) => redirect_to_workos_sign_in(request) } },
});
