import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  sidebar_menu_item_class_name,
} from '@coworker/ui/components/sidebar';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { AppNavLink } from '@/components/app/app_nav_link';
import { DevSettings, dev_settings_available } from '@/components/app/dev_settings';
import { app_home_page } from '@/lib/app_navigation';
import {
  type SettingsSectionDefinition,
  settings_group_definitions,
  settings_section_definitions,
  settings_section_path,
} from '@/lib/settings_navigation';

export const SidebarSettingsNav = memo(function SidebarSettingsNav({
  active_section_id,
}: {
  active_section_id: string;
}) {
  return (
    <>
      <SidebarGroup className="px-2.5 pt-3 pb-1">
        <AppNavLink
          href={app_home_page.path}
          className={`${sidebar_menu_item_class_name} h-8 px-2 font-medium`}
        >
          <ArrowLeft />
          <span className="truncate">Go back</span>
        </AppNavLink>
      </SidebarGroup>

      <SidebarContent>
        {settings_group_definitions.map((group) => {
          const sections = settings_section_definitions.filter(
            (section) => section.group === group.group_id,
          );
          if (sections.length === 0) return null;

          return (
            <SidebarGroup key={group.group_id}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {sections.map((section) => (
                  <SettingsSectionLink
                    key={section.section_id}
                    section={section}
                    isActive={section.section_id === active_section_id}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
        {dev_settings_available ? (
          <SidebarGroup>
            <DevSettings />
          </SidebarGroup>
        ) : null}
      </SidebarContent>
    </>
  );
});

function SettingsSectionLink({
  section,
  isActive,
}: {
  section: SettingsSectionDefinition;
  isActive: boolean;
}) {
  const Icon = section.icon;

  return (
    <SidebarMenuItem>
      <AppNavLink
        href={settings_section_path(section.section_id)}
        aria-current={isActive ? 'page' : undefined}
        data-active={isActive ? 'true' : undefined}
        className={sidebar_menu_item_class_name}
      >
        <Icon />
        <span className="truncate">{section.title}</span>
      </AppNavLink>
    </SidebarMenuItem>
  );
}
