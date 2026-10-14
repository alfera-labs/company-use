import {
  Bot,
  Calculator,
  CalendarClock,
  FileText,
  Globe2,
  History,
  Images,
  Library,
  Link2,
  Puzzle,
} from 'lucide-react';
import { schedule_tool_words } from '@/components/app/automations/schedule_tool_words';
import { runtime_internal_tool_definitions } from '@/components/app/internal_tool_runtime_registry';
import type {
  InternalToolDefinition,
  InternalToolFamily,
} from '@/components/app/internal_tool_view';
import { workspace_internal_tool_definitions } from '@/components/app/internal_tool_workspace';

const internal_tool_definitions: Record<string, InternalToolDefinition> = {
  ...runtime_internal_tool_definitions,
  ...workspace_internal_tool_definitions,
};

export const internal_tool_family_metadata = {
  pages: { title: 'Pages', icon: Globe2 },
  images: { title: 'Images', icon: Images },
  files: { title: 'Files', icon: FileText },
  browser: { title: 'Browser', icon: Globe2 },
  catalog: { title: 'Tools', icon: Library },
  connections: { title: 'Connections', icon: Link2 },
  skills: { title: 'Skills', icon: Puzzle },
  schedules: { title: schedule_tool_words.list_title, icon: CalendarClock },
  calculation: { title: 'Calculation', icon: Calculator },
  assistant: { title: 'Assistant', icon: Bot },
  history: { title: 'Chat history', icon: History },
} satisfies Record<InternalToolFamily, { title: string; icon: typeof Globe2 }>;

const legacy_sandbox_aliases: Record<string, string> = {
  'sandbox-list_files': 'workspace-list_files',
  'sandbox-read_file': 'workspace-read_file',
  'sandbox-read_document': 'workspace-read_document',
  'sandbox-view_image': 'workspace-view_image',
  'sandbox-write_file': 'workspace-write_file',
  'sandbox-edit_file': 'workspace-edit_file',
  'sandbox-grep': 'workspace-grep',
  'sandbox-glob': 'workspace-glob',
  'sandbox-preview': 'workspace-preview',
};

export function lookup_internal_tool_definition(tool_name: string) {
  const normalized_name = normalize_internal_tool_name(tool_name);
  return internal_tool_definitions[normalized_name] ?? null;
}

function normalize_internal_tool_name(tool_name: string) {
  const without_version = tool_name.replace(/-\d+$/u, '');
  const normalized_separator = without_version.replaceAll('.', '-');
  return legacy_sandbox_aliases[normalized_separator] ?? normalized_separator;
}
