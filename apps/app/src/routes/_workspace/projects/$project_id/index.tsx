import { createFileRoute } from '@tanstack/react-router';
import { AppContentArea } from '@/components/app/app_content_area';
import { ProjectHomePage } from '@/components/app/project_home_page';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/projects/$project_id/')({
  head: () => ({ meta: [{ title: page_title('Project') }] }),
  component: ProjectRoutePage,
});

function ProjectRoutePage() {
  const { project_id } = Route.useParams();
  return (
    <AppContentArea>
      <ProjectHomePage project_id={project_id} />
    </AppContentArea>
  );
}
