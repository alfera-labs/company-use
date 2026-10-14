import { format_error_message } from '@coworker/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@coworker/ui/components/alert-dialog';
import { Button } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Input } from '@coworker/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BrandMark } from '@/components/app/brand_mark';
import { InviteUsersItem, WorkspaceSwitchItems } from '@/components/app/workspace_switch_items';
import { get_workspaces } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { app_page_definitions } from '@/lib/app_navigation';
import { settings_section_definitions, settings_section_path } from '@/lib/settings_navigation';
import { create_workspace, switch_workspace } from '@/lib/workspace_actions';

const workspace_menu_pages = app_page_definitions.filter(
  (page) => page.placement === 'workspace' && page.page_id !== 'settings',
);
const workspace_settings_section = settings_section_definitions.find(
  (section) => section.section_id === 'workspace',
);
const team_section = settings_section_definitions.find((section) => section.section_id === 'team');

export function WorkspaceSwitcher({
  current_name,
  single_workspace_view = 'name',
  can_make_workspaces = true,
}: {
  current_name: string;
  single_workspace_view?: 'name' | 'hidden';
  can_make_workspaces?: boolean;
}) {
  const router = useRouter();
  const query_client = useQueryClient();
  const [switching, start_switch] = useTransition();
  const [dialog_open, set_dialog_open] = useState(false);
  const [new_name, set_new_name] = useState('');
  const workspaces_query = useQuery({ queryKey: query_keys.workspaces(), queryFn: get_workspaces });

  const create = useMutation({
    mutationFn: (name: string) => create_workspace({ data: name }),
    onSuccess: () => {
      set_dialog_open(false);
      set_new_name('');
      query_client.clear();
      router.invalidate();
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not create workspace.')),
  });

  function select(organization_id: string, is_active: boolean) {
    if (is_active) return;
    start_switch(async () => {
      try {
        await switch_workspace({ data: organization_id });
        query_client.clear();
        router.invalidate();
      } catch (error) {
        toast.error(format_error_message(error, 'Could not switch workspace.'));
      }
    });
  }

  if (single_workspace_view === 'hidden' && !has_multiple_workspaces(workspaces_query.data)) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={switching}
          render={<WorkspaceMenuTrigger current_name={current_name} />}
        />
        <DropdownMenuContent align="start" className="w-64 min-w-0 max-w-[calc(100vw-2rem)]">
          {single_workspace_view === 'name' ? (
            <>
              <InviteUsersItem />
              {workspace_settings_section ? (
                <DropdownMenuItem
                  render={
                    <Link
                      to={settings_section_path(workspace_settings_section.section_id)}
                      data-sidebar-close
                    />
                  }
                >
                  <workspace_settings_section.icon />
                  Workspace settings
                </DropdownMenuItem>
              ) : null}
              {workspace_menu_pages.map((page) => (
                <DropdownMenuItem
                  key={page.page_id}
                  render={<Link to={page.path} data-sidebar-close />}
                >
                  <page.icon />
                  {page.title}
                </DropdownMenuItem>
              ))}
              {team_section ? (
                <DropdownMenuItem
                  render={
                    <Link to={settings_section_path(team_section.section_id)} data-sidebar-close />
                  }
                >
                  <team_section.icon />
                  Members
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          <WorkspaceSwitchItems
            workspaces={workspaces_query.data ?? []}
            can_make_workspaces={can_make_workspaces}
            has_items_above={single_workspace_view === 'name'}
            on_select={select}
            on_new_workspace={() => set_dialog_open(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={dialog_open} onOpenChange={set_dialog_open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create workspace</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={new_name}
            placeholder="Workspace name"
            onChange={(event) => set_new_name(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && new_name.trim() && !create.isPending) {
                create.mutate(new_name.trim());
              }
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              disabled={create.isPending || !new_name.trim()}
              onClick={() => create.mutate(new_name.trim())}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function has_multiple_workspaces(workspaces: readonly unknown[] | undefined) {
  return (workspaces?.length ?? 0) >= 2;
}

export function WorkspaceMenuTrigger({
  current_name,
  ...props
}: React.ComponentProps<'button'> & { current_name: string }) {
  return (
    <button
      {...props}
      type="button"
      aria-label="Workspace menu"
      title={current_name}
      className="group/workspace flex h-9 w-fit min-w-0 max-w-full items-center gap-1 rounded-2xl px-1 text-left transition-colors hover:bg-sidebar-accent data-[popup-open]:bg-sidebar-accent"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-2xl text-foreground">
        <BrandMark className="size-5" />
      </span>
      <span className="min-w-0 truncate font-medium text-foreground">{current_name}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[popup-open]/workspace:rotate-180" />
    </button>
  );
}
