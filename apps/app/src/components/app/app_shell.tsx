import { public_brand_config } from '@coworker/config/public_env';
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarTrigger,
  useSidebar,
} from '@coworker/ui/components/sidebar';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { ChevronsRight, Menu } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { BrandMark } from '@/components/app/brand_mark';
import { BrowserTimezoneRecorder } from '@/components/app/browser_timezone_recorder';
import { CommandPalette } from '@/components/app/command_palette/command_palette';
import { CommandPaletteTrigger } from '@/components/app/command_palette/command_palette_trigger';
import { useCommandPaletteShortcut } from '@/components/app/command_palette/use_command_palette_shortcut';
import { RunCompletionNotifier } from '@/components/app/run_completion_notifier';
import { SidebarMainNav } from '@/components/app/sidebar_main_nav';
import { SidebarModeStack } from '@/components/app/sidebar_mode_stack';
import { SidebarPromoBanner } from '@/components/app/sidebar_promo_banner';
import { SidebarSettingsNav } from '@/components/app/sidebar_settings_nav';
import { SidebarUserMenu } from '@/components/app/sidebar_user_menu';
import { WorkspaceSwitcher } from '@/components/app/workspace_switcher';
import { QuestCelebrations } from '@/components/rewards/quest_celebrations';
import { QuestTourHost } from '@/components/rewards/quest_tour/quest_tour_host';
import { SidebarGetStartedCard } from '@/components/rewards/sidebar_get_started_card';
import { get_current_workspace } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { find_active_app_page } from '@/lib/app_navigation';
import { find_active_settings_section, is_settings_path } from '@/lib/settings_navigation';

const product_brand_name = public_brand_config.product_brand_name;

const shell_effects = (
  <>
    <RunCompletionNotifier />
    <BrowserTimezoneRecorder />
    <CommandPalette />
  </>
);
const shell_footer = (
  <>
    <SidebarGetStartedCard />
    <SidebarPromoBanner />
    <SidebarUserMenu />
  </>
);
const shell_overlays = (
  <>
    <QuestCelebrations />
    <QuestTourHost />
  </>
);

export function AppShell({
  children,
  banner,
  can_make_workspaces = true,
}: {
  children: ReactNode;
  banner?: ReactNode;
  can_make_workspaces?: boolean;
}) {
  const shell_header = useMemo(
    () => <SidebarBrandHeader can_make_workspaces={can_make_workspaces} />,
    [can_make_workspaces],
  );
  const in_settings = useLocation({ select: (location) => is_settings_path(location.pathname) });
  const active_page_id = useLocation({
    select: (location) => find_active_app_page(location.pathname).page_id,
  });
  const active_section_id = useLocation({
    select: (location) => find_active_settings_section(location.pathname).section_id,
  });
  useCommandPaletteShortcut();

  return (
    <AppShellView
      effects={shell_effects}
      header={shell_header}
      navigation={
        <SidebarModeStack
          active_mode_id={in_settings ? 'settings' : 'main'}
          modes={[
            { mode_id: 'main', panel: <SidebarMainNav active_page_id={active_page_id} /> },
            {
              mode_id: 'settings',
              panel: <SidebarSettingsNav active_section_id={active_section_id} />,
            },
          ]}
        />
      }
      footer={shell_footer}
    >
      {shell_overlays}
      {banner}
      {children}
    </AppShellView>
  );
}

function SidebarBrandHeader({ can_make_workspaces }: { can_make_workspaces: boolean }) {
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });

  return (
    <SidebarBrandHeaderView
      workspace_control={
        workspace_query.isLoading ? (
          <span className="flex flex-1 items-center gap-2 px-1">
            <span className="grid size-7 shrink-0 place-items-center rounded-2xl text-foreground">
              <BrandMark className="size-5" />
            </span>
            <Skeleton className="h-4 w-28" />
          </span>
        ) : (
          <WorkspaceSwitcher
            current_name={workspace_query.data?.workspace_name ?? product_brand_name}
            can_make_workspaces={can_make_workspaces}
          />
        )
      }
      search_control={<CommandPaletteTrigger />}
    />
  );
}

export function SidebarBrandHeaderView({
  workspace_control,
  search_control,
}: {
  workspace_control: ReactNode;
  search_control: ReactNode;
}) {
  const { collapsed, toggle } = useSidebar();
  if (collapsed) {
    return (
      <SidebarHeader className="items-center max-md:flex max-md:justify-between max-md:py-1.5">
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={toggle}
          className="group/brand relative mx-auto grid size-8 place-items-center rounded-2xl text-foreground transition-colors hover:bg-hover max-md:mx-0"
        >
          <BrandMark className="size-5 transition-opacity group-hover/brand:opacity-0 max-md:hidden" />
          <ChevronsRight className="absolute size-4 text-muted-foreground opacity-0 transition-opacity group-hover/brand:opacity-100 max-md:hidden" />
          <Menu className="size-5 md:hidden" />
        </button>
        <BrandMark className="size-5 md:hidden" />
        {search_control}
      </SidebarHeader>
    );
  }

  return (
    <SidebarHeader>
      <div className="flex h-9 items-center gap-1 px-1">
        <div className="min-w-0 flex-1">{workspace_control}</div>
        {search_control}
        <SidebarTrigger />
      </div>
    </SidebarHeader>
  );
}

export function AppShellView({
  children,
  className,
  header,
  navigation,
  footer,
  effects,
}: {
  children: ReactNode;
  className?: string;
  header: ReactNode;
  navigation: ReactNode;
  footer: ReactNode;
  effects?: ReactNode;
}) {
  return (
    <SidebarProvider className={className}>
      {effects}
      <Sidebar className="relative">
        <SidebarResizeHandle />
        {header}
        {navigation}
        <SidebarFooter className="border-t-0">{footer}</SidebarFooter>
      </Sidebar>
      <SidebarInset className="relative">{children}</SidebarInset>
    </SidebarProvider>
  );
}
