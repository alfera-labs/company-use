import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ProjectOverviewFields } from '@/components/app/project_overview_fields';
import { ProjectSection } from '@/components/app/project_section';
import { update_project } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

export type ProjectOverviewState = {
  fixed_identity: boolean;
  project_description: string;
  project_instructions: string;
  project_name: string;
  save_project: UseMutationResult<Project, Error, void>;
  set_project_description: (value: string) => void;
  set_project_instructions: (value: string) => void;
  set_project_name: (value: string) => void;
};

export function ProjectOverviewForm({
  project,
  can_manage,
}: {
  project: Project;
  can_manage: boolean;
}) {
  return (
    <ProjectSection title="Overview" description="Context for every chat here.">
      <ProjectOverviewEditor project={project} can_manage={can_manage} />
    </ProjectSection>
  );
}

function ProjectOverviewEditor({ project, can_manage }: { project: Project; can_manage: boolean }) {
  const query_client = useQueryClient();
  const [project_name, set_project_name] = useState(project.project_name);
  const [project_description, set_project_description] = useState(
    project.project_description ?? '',
  );
  const [project_instructions, set_project_instructions] = useState(
    project.project_instructions ?? '',
  );
  const fixed_identity = Boolean(project.personal_for_user_id);
  useEffect(() => {
    set_project_name(project.project_name);
    set_project_description(project.project_description ?? '');
    set_project_instructions(project.project_instructions ?? '');
  }, [project]);
  const save_project = useMutation({
    mutationFn: () =>
      update_project(project.project_id, {
        ...(fixed_identity ? {} : { project_name: project_name.trim() }),
        project_description: project_description.trim() || null,
        project_instructions: project_instructions.trim() || null,
      }),
    onSuccess: (updated) => {
      query_client.setQueryData(query_keys.project(project.project_id), updated);
      query_client.invalidateQueries({ queryKey: query_keys.projects() });
      toast.success('Project saved.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <ProjectOverviewFields
      project={project}
      can_manage={can_manage}
      form={{
        fixed_identity,
        project_description,
        project_instructions,
        project_name,
        save_project,
        set_project_description,
        set_project_instructions,
        set_project_name,
      }}
    />
  );
}
