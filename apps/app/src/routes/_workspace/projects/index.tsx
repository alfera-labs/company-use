import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { ProjectsPage } from '@/components/app/projects_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/projects/')({
  head: () => ({ meta: [{ title: page_title('Projects') }] }),
  component: ProjectsRoutePage,
});

function ProjectsRoutePage() {
  return (
    <AppContentArea>
      <ProjectsPage />
    </AppContentArea>
  );
}
