import { Badge } from '@coworker/ui/components/badge';
import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import { Textarea } from '@coworker/ui/components/textarea';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectOverviewState } from '@/components/app/project_overview_form';
import { update_project } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

export function ProjectOverviewFields({
  project,
  form,
  can_manage,
}: {
  project: Project;
  form: ProjectOverviewState;
  can_manage: boolean;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.save_project.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <ProjectAccessLabel project={project} fixed_identity={form.fixed_identity} />
        <ProjectOverviewActions project={project} form={form} can_manage={can_manage} />
      </div>
      <Field label="Name" html_for="project-name">
        <Input
          id="project-name"
          autoFocus={should_name_the_project()}
          onFocus={(event) => event.target.select()}
          value={form.project_name}
          disabled={form.fixed_identity || !can_manage}
          onChange={(event) => form.set_project_name(event.target.value)}
        />
      </Field>
      <Field
        label="Description"
        hint="Alfera reads this in every chat here."
        html_for="project-description"
      >
        <Textarea
          id="project-description"
          rows={3}
          disabled={!can_manage}
          value={form.project_description}
          placeholder="e.g. Campaigns, landing pages and email for the UK store."
          onChange={(event) => form.set_project_description(event.target.value)}
        />
      </Field>
      <ProjectInstructionsField form={form} can_manage={can_manage} />
    </form>
  );
}

function should_name_the_project() {
  return globalThis.location?.search.includes('new=1') ?? false;
}

function ProjectInstructionsField({
  form,
  can_manage,
}: {
  form: ProjectOverviewState;
  can_manage: boolean;
}) {
  return (
    <Field label="Instructions" hint="Rules for every chat here." html_for="project-instructions">
      <Textarea
        id="project-instructions"
        rows={7}
        disabled={!can_manage}
        value={form.project_instructions}
        placeholder={
          'e.g. Always write in British English.\nNever mention discounts before launch.'
        }
        onChange={(event) => form.set_project_instructions(event.target.value)}
      />
    </Field>
  );
}

function ProjectAccessLabel({
  project,
  fixed_identity,
}: {
  project: Project;
  fixed_identity: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary">{access_label(project.project_access)}</Badge>
      {fixed_identity ? (
        <span className="text-muted-foreground text-xs">Default project</span>
      ) : null}
    </div>
  );
}

function ProjectOverviewActions({
  project,
  form,
  can_manage,
}: {
  project: Project;
  form: ProjectOverviewState;
  can_manage: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <ArchiveProjectButton project={project} disabled={form.fixed_identity || !can_manage} />
      <Button
        type="submit"
        disabled={!can_manage || form.save_project.isPending || !form.project_name.trim()}
      >
        {form.save_project.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Save
      </Button>
    </div>
  );
}

function ArchiveProjectButton({ project, disabled }: { project: Project; disabled: boolean }) {
  const query_client = useQueryClient();
  const archive_project = useMutation({
    mutationFn: () => update_project(project.project_id, { project_status: 'archived' }),
    onSuccess: () => {
      query_client.invalidateQueries({ queryKey: query_keys.projects() });
      globalThis.location.assign('/projects');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Button
      type="button"
      variant="ghost"
      className="text-destructive"
      disabled={disabled || archive_project.isPending}
      onClick={() => {
        if (globalThis.confirm(`Archive ${project.project_name}?`)) archive_project.mutate();
      }}
    >
      Archive
    </Button>
  );
}

function Field({
  label,
  hint,
  html_for,
  children,
}: {
  label: string;
  hint?: string;
  html_for: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm" htmlFor={html_for}>
      <span className="font-medium">{label}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      {children}
    </label>
  );
}

function access_label(access: Project['project_access']) {
  if (access === 'private') return 'Private';
  if (access === 'workspace') return 'Workspace';
  return 'Members';
}
