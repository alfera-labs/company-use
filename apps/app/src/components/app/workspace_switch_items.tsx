import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, Check, ChevronRight, Plus, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { use_is_plain_team_member } from '@/components/app/use_team_mode';
import type { WorkspaceSummary } from '@/lib/api/types';
import { settings_section_path } from '@/lib/settings_navigation';

/**
 * "Invite users", the first item of the workspace menu, with the line under it. A plain member
 * of a team-mode install cannot invite, so the menu does not offer it to them.
 */
export function InviteUsersItem() {
  if (use_is_plain_team_member()) return null;
  return (
    <>
      <DropdownMenuItem render={<Link to={settings_section_path('team')} data-sidebar-close />}>
        <UserPlus />
        Invite users
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

/**
 * The last items of the workspace menu. "Switch workspace" shows only when there is another
 * workspace to switch to, and "New workspace" only where this sign-in can make one. With one
 * workspace that can make more, "New workspace" is an item of the menu itself.
 */
export function WorkspaceSwitchItems({
  workspaces,
  can_make_workspaces,
  has_items_above,
  on_select,
  on_new_workspace,
}: {
  workspaces: readonly WorkspaceSummary[];
  can_make_workspaces: boolean;
  has_items_above: boolean;
  on_select: (organization_id: string, is_active: boolean) => void;
  on_new_workspace: () => void;
}) {
  const new_workspace_item = can_make_workspaces ? (
    <DropdownMenuItem onClick={on_new_workspace}>
      <Plus />
      New workspace
    </DropdownMenuItem>
  ) : null;
  if (workspaces.length < 2 && !new_workspace_item) return null;
  return (
    <>
      {has_items_above ? <DropdownMenuSeparator /> : null}
      {workspaces.length < 2 ? (
        new_workspace_item
      ) : (
        <SwitchWorkspaceSubmenu workspaces={workspaces} on_select={on_select}>
          {new_workspace_item ? <DropdownMenuSeparator /> : null}
          {new_workspace_item}
        </SwitchWorkspaceSubmenu>
      )}
    </>
  );
}

function SwitchWorkspaceSubmenu({
  workspaces,
  on_select,
  children,
}: {
  workspaces: readonly WorkspaceSummary[];
  on_select: (organization_id: string, is_active: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSubmenu>
      <DropdownMenuSubmenuTrigger>
        <ArrowLeftRight />
        Switch workspace
        <ChevronRight className="ml-auto" />
      </DropdownMenuSubmenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={4}
        className="w-64 min-w-0 max-w-[calc(100vw-2rem)]"
      >
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.workspace_id}
            onClick={() => on_select(workspace.organization_id, workspace.is_active)}
          >
            <span className="flex-1 truncate">{workspace.workspace_name}</span>
            {workspace.is_active ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        {children}
      </DropdownMenuContent>
    </DropdownMenuSubmenu>
  );
}
