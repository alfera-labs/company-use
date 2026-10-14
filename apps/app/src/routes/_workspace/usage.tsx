import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/_workspace/usage')({
  loader: () => {
    throw notFound();
  },
});
