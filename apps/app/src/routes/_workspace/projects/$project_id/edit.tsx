import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { ProjectDetailPage } from '@/components/app/project_detail_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/projects/$project_id/edit')({
  head: () => ({ meta: [{ title: page_title('Project settings') }] }),
  component: ProjectEditRoutePage,
});

function ProjectEditRoutePage() {
  const { project_id } = Route.useParams();
  return (
    <AppContentArea>
      <ProjectDetailPage project_id={project_id} />
    </AppContentArea>
  );
}
