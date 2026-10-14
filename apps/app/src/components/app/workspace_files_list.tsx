import { Input } from '@coworker/ui/components/input';
import { cn } from '@coworker/ui/lib/utils';
import { Folder, Search } from 'lucide-react';
import { useState } from 'react';
import { workspace_file_visual } from '@/components/app/workspace_file_visuals';
import { order_workspace_listing } from '@/components/app/workspace_files_order';
import type { WorkspaceFileEntry, WorkspaceFolderEntry } from '@/lib/api';

const row_class_name =
  'flex h-10 w-full items-center gap-2.5 rounded-2xl px-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The entries of one folder: the folders that hold files, the files, then the empty folders.
 * Hidden items stay out until the person asks for them.
 */
export function WorkspaceFilesList({
  listing,
  folderPath,
  onOpenFile,
  onOpenFolder,
}: {
  listing: { folders: WorkspaceFolderEntry[]; files: WorkspaceFileEntry[] };
  folderPath: string;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const [filter_text, set_filter_text] = useState('');
  const [show_hidden, set_show_hidden] = useState(false);
  const shown = order_workspace_listing(listing, {
    folder_path: folderPath,
    name_filter: filter_text,
    show_hidden,
  });
  const open_folder = (name: string) => onOpenFolder(join_workspace_path(folderPath, name));
  const shown_count = shown.folders.length + shown.files.length + shown.empty_folders.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NameFilter filter_text={filter_text} onChange={set_filter_text} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
        {shown_count === 0 ? (
          <EmptyNotice>
            {filter_text.trim() ? `Nothing matches "${filter_text.trim()}".` : 'No files to show.'}
          </EmptyNotice>
        ) : null}
        <FolderSection label="Folders" folders={shown.folders} onOpen={open_folder} />
        <FileSection
          files={shown.files}
          onOpen={(name) => onOpenFile(join_workspace_path(folderPath, name))}
        />
        <FolderSection label="Empty folders" folders={shown.empty_folders} onOpen={open_folder} />
        {shown.hidden_count > 0 ? (
          <button
            className="px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            type="button"
            onClick={() => set_show_hidden(!show_hidden)}
          >
            {show_hidden ? 'Hide hidden items' : `Show hidden items (${shown.hidden_count})`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NameFilter({
  filter_text,
  onChange,
}: {
  filter_text: string;
  onChange: (filter_text: string) => void;
}) {
  return (
    <div className="relative mx-4 mt-3">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Filter files"
        className="h-8 pl-8 text-sm"
        placeholder="Filter files..."
        value={filter_text}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function FolderSection({
  label,
  folders,
  onOpen,
}: {
  label: string;
  folders: WorkspaceFolderEntry[];
  onOpen: (folder_name: string) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <div className="space-y-0.5">
        {folders.map(({ folder_name }) => (
          <button
            className={row_class_name}
            key={folder_name}
            title={folder_name}
            type="button"
            onClick={() => onOpen(folder_name)}
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-sm font-normal">{folder_name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FileSection({
  files,
  onOpen,
}: {
  files: WorkspaceFileEntry[];
  onOpen: (file_name: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <section>
      <SectionLabel>Files</SectionLabel>
      <div className="space-y-0.5">
        {files.map((file) => (
          <FileRow key={file.file_name} file={file} onOpen={() => onOpen(file.file_name)} />
        ))}
      </div>
    </section>
  );
}

function FileRow({ file, onOpen }: { file: WorkspaceFileEntry; onOpen: () => void }) {
  const { Icon, icon_class } = workspace_file_visual(file.file_name);
  return (
    <button className={row_class_name} title={file.file_name} type="button" onClick={onOpen}>
      <Icon className={cn('size-4 shrink-0', icon_class)} />
      <span className="min-w-0 flex-1 truncate text-sm font-normal">{file.file_name}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">{children}</div>;
}

export function EmptyNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <p className="max-w-xs text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function join_workspace_path(folder_path: string, entry_name: string) {
  return folder_path === '' ? entry_name : `${folder_path}/${entry_name}`;
}
