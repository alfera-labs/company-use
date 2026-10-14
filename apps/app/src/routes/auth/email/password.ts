import { createFileRoute } from '@tanstack/react-router';
import { sign_in_with_password } from '@/lib/workos_magic_auth';

export const Route = createFileRoute('/auth/email/password')({
  server: { handlers: { POST: ({ request }) => sign_in_with_password(request) } },
});
