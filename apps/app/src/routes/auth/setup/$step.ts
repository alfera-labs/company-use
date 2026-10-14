import { createFileRoute } from '@tanstack/react-router';
import { forward_install_sign_in_step } from '@/lib/install_sign_in_api';

export const Route = createFileRoute('/auth/setup/$step')({
  server: {
    handlers: {
      POST: ({ request, params }) => forward_install_sign_in_step(request, `setup/${params.step}`),
    },
  },
});
