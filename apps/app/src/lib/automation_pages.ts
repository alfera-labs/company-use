import { Repeat } from 'lucide-react';
import type { AppPageDefinition } from '@/lib/app_navigation';

export const automation_pages: AppPageDefinition[] = [
  {
    page_id: 'automations',
    title: 'Automations',
    path: '/automations',
    icon: Repeat,
    placement: 'visible',
  },
];
