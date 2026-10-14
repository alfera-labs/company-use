import { createFileRoute } from '@tanstack/react-router';
import { read_workos_auth } from '@/lib/workos_session';

export const Route = createFileRoute('/auth/session')({
  server: {
    handlers: {
      GET: async () => {
        const auth = await read_workos_auth();
        return Response.json(
          {
            user: auth.user
              ? {
                  id: auth.user.id,
                  email: auth.user.email,
                  firstName: auth.user.firstName,
                  lastName: auth.user.lastName,
                  profilePictureUrl: auth.user.profilePictureUrl,
                }
              : null,
            organizationId: auth.organizationId ?? null,
            impersonator: auth.impersonator
              ? { email: auth.impersonator.email, reason: auth.impersonator.reason ?? null }
              : null,
          },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      },
    },
  },
});
