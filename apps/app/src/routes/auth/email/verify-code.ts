import { createFileRoute } from '@tanstack/react-router';
import { verify_magic_auth_code } from '@/lib/workos_magic_auth';

export const Route = createFileRoute('/auth/email/verify-code')({
  server: { handlers: { POST: ({ request }) => verify_magic_auth_code(request) } },
});
