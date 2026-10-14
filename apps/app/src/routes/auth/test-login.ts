import { createFileRoute } from '@tanstack/react-router';

function answer_not_found() {
  return new Response('Not found', { status: 404 });
}

export const Route = createFileRoute('/auth/test-login')({
  server: {
    handlers: {
      GET: answer_not_found,
      POST: answer_not_found,
    },
  },
});
