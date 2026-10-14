import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  sidebar_menu_item_class_name,
  useSidebar,
} from '@coworker/ui/components/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@coworker/ui/components/tooltip';
import { memo, type ReactElement, type ReactNode } from 'react';
import { AppNavLink } from '@/components/app/app_nav_link';
import { SidebarChatRooms } from '@/components/app/sidebar_chat_rooms';
import { SidebarTalkToFounders } from '@/components/app/sidebar_talk_to_founders';
import { use_pending_tool_approvals } from '@/components/app/tool_approval_decision';
import { type AppPageDefinition, app_page_definitions } from '@/lib/app_navigation';

export const SidebarMainNav = memo(function SidebarMainNav({
  active_page_id,
}: {
  active_page_id: string;
}) {
  return (
    <SidebarMainNavView
      navigation={app_page_definitions
        .filter((page) => page.placement === 'visible')
        .map((page) => (
          <SidebarPageLinkView
            key={page.page_id}
            page={page}
            isActive={active_page_id === page.page_id}
            badge={page.page_id === 'inbox' ? <WaitingForYouCount /> : null}
          />
        ))}
      extra={<SidebarTalkToFounders />}
    >
      <SidebarChatRooms />
    </SidebarMainNavView>
  );
});

export function SidebarMainNavView({
  navigation,
  extra,
  children,
}: {
  navigation: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarMenu>
          {navigation}
          {extra ? <SidebarMenuItem>{extra}</SidebarMenuItem> : null}
        </SidebarMenu>
      </SidebarGroup>
      {children}
    </SidebarContent>
  );
}

export function SidebarPageLinkView({
  isActive,
  page,
  badge,
  on_select,
  disabled = false,
}: {
  isActive: boolean;
  page: AppPageDefinition;
  badge?: ReactNode;
  on_select?: () => void;
  disabled?: boolean;
}) {
  const Icon = page.icon;
  const content = (
    <>
      <Icon />
      <span className="truncate">{page.title}</span>
      {badge}
    </>
  );
  const attributes = {
    'aria-current': isActive ? ('page' as const) : undefined,
    'data-active': isActive ? 'true' : undefined,
    className: sidebar_menu_item_class_name,
  };
  return (
    <SidebarMenuItem>
      <SidebarNavTooltip label={page.title}>
        {on_select ? (
          <button type="button" {...attributes} disabled={disabled} onClick={on_select}>
            {content}
          </button>
        ) : (
          <AppNavLink href={page.path} {...attributes}>
            {content}
          </AppNavLink>
        )}
      </SidebarNavTooltip>
    </SidebarMenuItem>
  );
}

function WaitingForYouCount() {
  const approvals = use_pending_tool_approvals();
  const count = approvals.data?.length ?? 0;
  if (count === 0) return null;

  return (
    <span className="ml-auto min-w-5 rounded-full bg-caution-wash px-1.5 text-center font-medium text-[11px] text-caution-ink leading-5">
      {count}
    </span>
  );
}

function SidebarNavTooltip({ label, children }: { label: string; children: ReactElement }) {
  const { collapsed } = useSidebar();
  if (!collapsed) return children;

  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
