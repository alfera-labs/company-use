import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_workspace/scheduled-tasks/$trigger_id')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/automations/$automation_id',
      params: { automation_id: params.trigger_id },
    });
  },
});
