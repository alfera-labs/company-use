import { createFileRoute } from '@tanstack/react-router';
import { verify_email_ownership } from '@/lib/workos_magic_auth';

export const Route = createFileRoute('/auth/email/verify-ownership')({
  server: { handlers: { POST: ({ request }) => verify_email_ownership(request) } },
});
