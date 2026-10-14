import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/sessions/$session_id')({
  loader: () => {
    throw notFound();
  },
});
