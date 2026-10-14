import {
  AppWindow,
  Boxes,
  Brain,
  Calculator,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  Cpu,
  Eye,
  FileCode2,
  FileDown,
  FilePenLine,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderSearch,
  Globe,
  Image as ImageGlyph,
  Images,
  type LucideIcon,
  MessagesSquare,
  Paperclip,
  Play,
  Plug,
  PlugZap,
  Search,
  SearchCode,
  SlidersHorizontal,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { chat_lookback_labels } from '@/components/app/lookup_tool_words';
import { memory_tool_running_labels } from '@/lib/memory_tool_labels';

const system_tool_icons: Record<string, LucideIcon> = {
  'runtime-web_search': Search,
  'runtime-read_url': Globe,
  'runtime-image_search': Images,
  'runtime-search_tools': Boxes,
  'runtime-get_tool_schema': FileCode2,
  'runtime-execute_tool': Play,
  'runtime-configure_tool': SlidersHorizontal,
  'runtime-search_documents': Brain,
  'runtime-read_document': Brain,
  'runtime-download_document_original': FileDown,
  'runtime-search_context': MessagesSquare,
  'runtime-load_skill': Sparkles,
  'runtime-read_attachment': Paperclip,
  'runtime-list_connections': Plug,
  'runtime-create_connection': PlugZap,

  'scheduled_tasks-create_scheduled_task': CalendarPlus,
  'scheduled_tasks-edit_scheduled_task': CalendarClock,
  'scheduled_tasks-list_scheduled_tasks': CalendarDays,
  'scheduled_tasks-delete_scheduled_task': CalendarX2,
  'scheduled_tasks-set_scheduled_task_status': CalendarCheck2,

  'workspace-run_command': Terminal,
  'workspace-read_file': FileText,
  'workspace-write_file': FilePlus2,
  'workspace-edit_file': FilePenLine,
  'workspace-grep': SearchCode,
  'workspace-glob': FolderSearch,
  'workspace-list_files': FolderOpen,
  'workspace-view_image': ImageGlyph,
  'workspace-preview': Eye,

  browser: AppWindow,
  'math-calculate': Calculator,
};

const system_tool_labels: Record<string, string> = {
  ...memory_tool_running_labels,
  'runtime-search_context': chat_lookback_labels.running,
};

const system_app_icons: Record<string, LucideIcon> = {
  runtime: Cpu,
  scheduled_tasks: CalendarClock,
  workspace: Terminal,
  sandbox: Terminal,
  browser: AppWindow,
  math: Calculator,
};

function normalize_node_key(node_key: string) {
  return node_key.replace(/\./g, '-').replace(/-\d+$/, '');
}

function system_app_name(normalized_key: string) {
  const separator = normalized_key.indexOf('-');
  return separator === -1 ? normalized_key : normalized_key.slice(0, separator);
}

export function resolve_system_tool_icon(node_key: string): LucideIcon | undefined {
  const normalized = normalize_node_key(node_key);
  return system_tool_icons[normalized] ?? system_app_icons[system_app_name(normalized)];
}

export function resolve_system_tool_label(node_key: string): string | undefined {
  return system_tool_labels[normalize_node_key(node_key)];
}
