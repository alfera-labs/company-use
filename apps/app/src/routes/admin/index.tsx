import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/')({
  loader: () => {
    throw notFound();
  },
});
