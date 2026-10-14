import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/billing')({
  loader: () => {
    throw notFound();
  },
});
