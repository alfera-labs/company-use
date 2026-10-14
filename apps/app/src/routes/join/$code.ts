import { createFileRoute } from '@tanstack/react-router';
import { redirect_response } from '@/lib/http_response';
import { join_team_with_link, show_team_join_page } from '@/lib/team_join';
import { is_team_mode_on } from '@/lib/team_mode';

/**
 * In team mode this is the page a one-time sign-in link opens. In every other mode there is
 * nothing to join here, so the address leads to sign-in.
 */
export const Route = createFileRoute('/join/$code')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        is_team_mode_on()
          ? show_team_join_page(params.code)
          : redirect_response(new URL('/sign-in', request.url)),
      POST: ({ request, params }) =>
        is_team_mode_on()
          ? join_team_with_link(request, params.code)
          : redirect_response(new URL('/sign-in', request.url), 303),
    },
  },
});
