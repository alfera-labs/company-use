import {
  Code2,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  type LucideIcon,
} from 'lucide-react';

export type WorkspaceFileVisual = { Icon: LucideIcon; icon_class: string };

const visuals_by_extension: Record<string, WorkspaceFileVisual> = {
  pdf: { Icon: FileText, icon_class: 'text-muted-foreground' },
  csv: { Icon: FileSpreadsheet, icon_class: 'text-file-sheet' },
  tsv: { Icon: FileSpreadsheet, icon_class: 'text-file-sheet' },
  xls: { Icon: FileSpreadsheet, icon_class: 'text-file-sheet' },
  xlsx: { Icon: FileSpreadsheet, icon_class: 'text-file-sheet' },
  gif: { Icon: ImageIcon, icon_class: 'text-file-image' },
  jpeg: { Icon: ImageIcon, icon_class: 'text-file-image' },
  jpg: { Icon: ImageIcon, icon_class: 'text-file-image' },
  png: { Icon: ImageIcon, icon_class: 'text-file-image' },
  svg: { Icon: ImageIcon, icon_class: 'text-file-image' },
  webp: { Icon: ImageIcon, icon_class: 'text-file-image' },
  htm: { Icon: Globe, icon_class: 'text-file-code' },
  html: { Icon: Globe, icon_class: 'text-file-code' },
  css: { Icon: Code2, icon_class: 'text-file-code' },
  js: { Icon: Code2, icon_class: 'text-file-code' },
  json: { Icon: Code2, icon_class: 'text-file-code' },
  mjs: { Icon: Code2, icon_class: 'text-file-code' },
  py: { Icon: Code2, icon_class: 'text-file-code' },
  sh: { Icon: Code2, icon_class: 'text-file-code' },
  sql: { Icon: Code2, icon_class: 'text-file-code' },
  ts: { Icon: Code2, icon_class: 'text-file-code' },
  tsx: { Icon: Code2, icon_class: 'text-file-code' },
  xml: { Icon: Code2, icon_class: 'text-file-code' },
  yaml: { Icon: Code2, icon_class: 'text-file-code' },
  yml: { Icon: Code2, icon_class: 'text-file-code' },
};

const default_visual: WorkspaceFileVisual = { Icon: FileText, icon_class: 'text-muted-foreground' };

const image_extensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function workspace_file_extension(file_path: string) {
  const name = file_path.split('/').pop() ?? file_path;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return extension === name.toLowerCase() ? '' : extension;
}

export function is_image_file(file_path: string) {
  return image_extensions.has(workspace_file_extension(file_path));
}

export function workspace_file_visual(file_path: string): WorkspaceFileVisual {
  return visuals_by_extension[workspace_file_extension(file_path)] ?? default_visual;
}
