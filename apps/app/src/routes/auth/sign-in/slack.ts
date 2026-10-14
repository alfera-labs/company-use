import { createFileRoute } from '@tanstack/react-router';
import { redirect_to_slack_oauth } from '@/lib/workos_direct_oauth';

export const Route = createFileRoute('/auth/sign-in/slack')({
  server: { handlers: { GET: ({ request }) => redirect_to_slack_oauth(request) } },
});
