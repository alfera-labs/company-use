import { cn } from '@coworker/ui/lib/utils';
import { Plus, X } from 'lucide-react';
import { type Ref, useLayoutEffect, useRef } from 'react';
import { workspace_file_visual } from '@/components/app/workspace_file_visuals';

export function WorkspaceFileTabs({
  activeTab,
  onActivate,
  onClose,
  onNewTab,
  openTabs,
  dirtyTabs = [],
}: {
  activeTab: string | null;
  onActivate: (file_path: string) => void;
  onClose: (file_path: string) => void;
  onNewTab: () => void;
  openTabs: string[];
  dirtyTabs?: string[];
}) {
  const active_tab_ref = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTab drives which element holds the ref
  useLayoutEffect(() => {
    active_tab_ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-sunken px-2 py-1.5 [scrollbar-width:none]">
      {openTabs.map((file_path) => (
        <OpenFileTab
          file_path={file_path}
          has_unsaved_changes={dirtyTabs.includes(file_path)}
          is_active={file_path === activeTab}
          key={file_path}
          tab_ref={file_path === activeTab ? active_tab_ref : null}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
      <button
        aria-label="Browse for another file"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-2xl text-muted-foreground hover:bg-hover hover:text-foreground"
        type="button"
        onClick={onNewTab}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function OpenFileTab({
  file_path,
  has_unsaved_changes,
  is_active,
  tab_ref,
  onActivate,
  onClose,
}: {
  file_path: string;
  has_unsaved_changes: boolean;
  is_active: boolean;
  tab_ref: Ref<HTMLDivElement>;
  onActivate: (file_path: string) => void;
  onClose: (file_path: string) => void;
}) {
  const file_name = file_path.split('/').pop() || file_path;

  return (
    <div
      className={cn(
        'group/tab flex h-7 max-w-52 shrink-0 items-center gap-1 rounded-2xl pr-3 pl-1 text-xs font-medium transition-colors',
        is_active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
      ref={tab_ref}
      title={file_path}
    >
      <CloseButtonInTheIconSlot file_name={file_name} file_path={file_path} onClose={onClose} />
      <button
        aria-current={is_active ? 'page' : undefined}
        className="min-w-0 truncate"
        type="button"
        onClick={() => onActivate(file_path)}
      >
        {file_name}
      </button>
      {has_unsaved_changes ? (
        <span
          aria-label="Unsaved changes"
          className="size-1.5 shrink-0 rounded-full bg-primary"
          role="img"
        />
      ) : null}
    </div>
  );
}

function CloseButtonInTheIconSlot({
  file_name,
  file_path,
  onClose,
}: {
  file_name: string;
  file_path: string;
  onClose: (file_path: string) => void;
}) {
  const { Icon: FileTypeIcon, icon_class } = workspace_file_visual(file_path);

  return (
    <button
      aria-label={`Close ${file_name}`}
      className="relative flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10"
      type="button"
      onClick={() => onClose(file_path)}
    >
      <FileTypeIcon className={cn('size-3.5 group-hover/tab:invisible', icon_class)} />
      <X className="invisible absolute size-3 group-hover/tab:visible" />
    </button>
  );
}
