import {
  Bot,
  Building2,
  Hash,
  KeyRound,
  type LucideIcon,
  Mail,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  User,
  Users,
} from 'lucide-react';
import { edition_settings_sections } from '@/lib/edition_settings_sections';

export type SettingsSectionDefinition = {
  section_id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: SettingsGroupId;
  surface: 'panel' | 'bare' | 'wide';
};

export type SettingsGroupId = 'personal' | 'workspace' | 'access' | 'install';

export const settings_group_definitions: { group_id: SettingsGroupId; label: string }[] = [
  { group_id: 'personal', label: 'Personal' },
  { group_id: 'workspace', label: 'Workspace' },
  { group_id: 'access', label: 'People & access' },
  { group_id: 'install', label: 'This install' },
];

export const settings_section_definitions = [
  {
    section_id: 'profile',
    title: 'Profile',
    description: 'Your name, email, password, and sign-in methods.',
    icon: User,
    group: 'personal',
    surface: 'bare',
  },
  {
    section_id: 'preferences',
    title: 'Preferences',
    description: 'How the dashboard looks, and when it tells you a chat finished.',
    icon: SlidersHorizontal,
    group: 'personal',
    surface: 'bare',
  },
  {
    section_id: 'workspace',
    title: 'Workspace',
    description: 'The name of your workspace, and its ID.',
    icon: Building2,
    group: 'workspace',
    surface: 'bare',
  },
  {
    section_id: 'models',
    title: 'Models',
    description: 'The account your runs bill, and the default model they use.',
    icon: Bot,
    group: 'workspace',
    surface: 'bare',
  },
  {
    section_id: 'channels',
    title: 'Channels',
    description: 'Control where Alfera can read and respond in Slack.',
    icon: Hash,
    group: 'workspace',
    surface: 'panel',
  },
  {
    section_id: 'email',
    title: 'Email',
    description: 'Reach Alfera from your inbox.',
    icon: Mail,
    group: 'workspace',
    surface: 'panel',
  },
  {
    section_id: 'team',
    title: 'Team',
    description: 'Invite teammates and manage their roles.',
    icon: Users,
    group: 'access',
    surface: 'bare',
  },
  {
    section_id: 'access',
    title: 'Access',
    description: 'Where each teammate can use each connection.',
    icon: Table2,
    group: 'access',
    surface: 'wide',
  },
  {
    section_id: 'api-keys',
    title: 'API keys',
    description: 'Programmatic access to this workspace.',
    icon: KeyRound,
    group: 'access',
    surface: 'bare',
  },
  {
    section_id: 'policies',
    title: 'Tool permissions',
    description: 'Choose which tools run, ask first, or never run.',
    icon: ShieldCheck,
    group: 'access',
    surface: 'panel',
  },
  ...edition_settings_sections,
] as const satisfies readonly SettingsSectionDefinition[];

export type SettingsSectionId = (typeof settings_section_definitions)[number]['section_id'];

const settings_root_path = '/settings';

export function settings_section_path(section_id: string): string {
  return `${settings_root_path}/${section_id}`;
}

export const default_settings_section = settings_section_definitions[0];

export function find_settings_section(section_id: string | undefined) {
  if (!section_id) return default_settings_section;
  return (
    settings_section_definitions.find((section) => section.section_id === section_id) ??
    default_settings_section
  );
}

export function is_settings_path(pathname: string): boolean {
  return pathname === settings_root_path || pathname.startsWith(`${settings_root_path}/`);
}

export function find_active_settings_section(pathname: string) {
  if (!is_settings_path(pathname)) return default_settings_section;
  return find_settings_section(pathname.slice(settings_root_path.length).split('/')[1]);
}
