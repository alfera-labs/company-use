import { createFileRoute, redirect } from '@tanstack/react-router';
import { alfera_cloud_page } from '@/lib/alfera_cloud_page';

export const Route = createFileRoute('/_workspace/brain/')({
  beforeLoad: () => {
    throw redirect(alfera_cloud_page);
  },
});
