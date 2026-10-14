import { createFileRoute } from '@tanstack/react-router';
import { forward_install_sign_in_step } from '@/lib/install_sign_in_api';

export const Route = createFileRoute('/auth/password/$step')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        forward_install_sign_in_step(request, `password/${params.step}`),
      POST: ({ request, params }) =>
        forward_install_sign_in_step(request, `password/${params.step}`),
    },
  },
});
