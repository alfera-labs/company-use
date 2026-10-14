import { Cloud } from 'lucide-react';
import type { SettingsSectionDefinition } from '@/lib/settings_navigation';

export const edition_settings_sections = [
  {
    section_id: 'alfera-cloud',
    title: 'Alfera Cloud',
    description: 'What this install does, and what the cloud adds.',
    icon: Cloud,
    group: 'install',
    surface: 'panel',
  },
] as const satisfies readonly SettingsSectionDefinition[];
