import {
  Archive,
  FolderOpen,
  Inbox,
  LayoutTemplate,
  type LucideIcon,
  Plug,
  Settings,
  SquarePen,
} from 'lucide-react';
import { automation_pages } from '@/lib/automation_pages';
import { billing_pages, get_started_pages } from '@/lib/hosted_pages';
import { memory_pages } from '@/lib/memory_pages';

export type AppPageDefinition = {
  page_id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  placement: 'visible' | 'hidden' | 'workspace';
};

export const app_home_page: AppPageDefinition = {
  page_id: 'home',
  title: 'New chat',
  path: '/home',
  icon: SquarePen,
  placement: 'visible',
};

export const app_page_definitions: AppPageDefinition[] = [
  app_home_page,
  ...get_started_pages,
  {
    page_id: 'inbox',
    title: 'Inbox',
    path: '/inbox',
    icon: Inbox,
    placement: 'visible',
  },
  ...memory_pages,
  {
    page_id: 'projects',
    title: 'Projects',
    path: '/projects',
    icon: FolderOpen,
    placement: 'hidden',
  },
  ...automation_pages,
  {
    page_id: 'templates',
    title: 'Templates',
    path: '/templates',
    icon: LayoutTemplate,
    placement: 'visible',
  },
  { page_id: 'chats', title: 'Chats', path: '/chats', icon: Archive, placement: 'hidden' },
  {
    page_id: 'integrations',
    title: 'Integrations',
    path: '/integrations',
    icon: Plug,
    placement: 'workspace',
  },
  ...billing_pages,
  {
    page_id: 'settings',
    title: 'Settings',
    path: '/settings',
    icon: Settings,
    placement: 'workspace',
  },
];

export function find_active_app_page(pathname: string): AppPageDefinition {
  return (
    app_page_definitions
      .filter((page) => page.path !== '/')
      .find((page) => pathname === page.path || pathname.startsWith(`${page.path}/`)) ??
    app_home_page
  );
}
