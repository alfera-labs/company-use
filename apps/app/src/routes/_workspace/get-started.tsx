import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/_workspace/get-started')({
  loader: () => {
    throw notFound();
  },
});
