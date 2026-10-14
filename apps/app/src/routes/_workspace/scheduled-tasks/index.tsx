import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_workspace/scheduled-tasks/')({
  beforeLoad: () => {
    throw redirect({ to: '/automations' });
  },
});
