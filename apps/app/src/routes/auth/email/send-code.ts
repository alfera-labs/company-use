import { createFileRoute } from '@tanstack/react-router';
import { send_magic_auth_code } from '@/lib/workos_magic_auth';

export const Route = createFileRoute('/auth/email/send-code')({
  server: { handlers: { POST: ({ request }) => send_magic_auth_code(request) } },
});
