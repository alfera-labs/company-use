import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { ArrowLeft, Maximize2, Minimize2, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserTask } from '@/components/app/browser_live_view/browser_task_controls';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { FilesPanelWidthHandle } from '@/components/app/files_panel_width_handle';
import { use_folder_of_newest_chat_file } from '@/components/app/use_folder_of_newest_chat_file';
import { WorkspaceBrowserView } from '@/components/app/workspace_browser_view';
import { useDiscardChanges } from '@/components/app/workspace_documents/discard_changes';
import {
  file_draft_key,
  use_file_drafts,
  useFileNavigationGuard,
} from '@/components/app/workspace_documents/file_drafts';
import { WorkspaceFileReader } from '@/components/app/workspace_file_reader';
import { WorkspaceFileTabs } from '@/components/app/workspace_file_tabs';
import { WorkspaceFilesGrid } from '@/components/app/workspace_files_grid';
import { WorkspaceFolderBreadcrumb } from '@/components/app/workspace_folder_breadcrumb';
import type { SandboxUrlPreview } from '@/lib/api';
import { useSandboxShowsALiveBrowser } from '@/lib/use_install_has_app_catalogue';

type PanelMode = 'files' | 'browser';

export type WorkspaceFileViews = {
  render_file: (file_path: string) => ReactNode;
  render_listing: (props: {
    folderPath: string;
    onOpenFile: (path: string) => void;
    onOpenFolder: (path: string) => void;
  }) => ReactNode;
  browser: ReactNode;
};

export function WorkspaceFilesPanel({
  onClose,
  sandboxPreviews,
  session_id,
  browser_task,
  workspace_id,
  is_open = true,
  file_views,
}: {
  onClose: () => void;
  sandboxPreviews: SandboxUrlPreview[];
  session_id: string | undefined;
  browser_task?: BrowserTask | undefined;
  workspace_id: string;
  is_open?: boolean;
  file_views?: WorkspaceFileViews;
}) {
  const { confirm_discard, discard_dialog } = useDiscardChanges();
  const panel_ref = useRef<HTMLDialogElement>(null);
  const opener_ref = useRef<HTMLElement | null>(null);
  const close_panel = () => {
    panel_ref.current?.close();
    if (opener_ref.current?.isConnected) opener_ref.current.focus({ preventScroll: true });
    onClose();
  };
  const has_browser = useSandboxShowsALiveBrowser() !== false;
  const mode = useChatUiStore((state) => (has_browser ? state.files_panel_mode : 'files'));
  const set_mode = useChatUiStore((state) => state.set_files_panel_mode);
  const [chosen_folder_path, set_folder_path] = useState<string | null>(null);
  const newest_file_folder = use_folder_of_newest_chat_file(session_id, is_open);
  const folder_path = chosen_folder_path ?? newest_file_folder ?? '';
  const knows_where_to_open = chosen_folder_path !== null || newest_file_folder !== undefined;
  const stored_tabs = use_file_drafts((state) => state.tabs[workspace_id]);
  const open_tabs = stored_tabs ?? [];
  const set_tabs = use_file_drafts((state) => state.set_tabs);
  const drafts = use_file_drafts((state) => state.drafts);
  const set_draft = use_file_drafts((state) => state.set_draft);
  const [expanded, set_expanded] = useState(false);
  const [tab_notice, set_tab_notice] = useState<string | null>(null);
  useFileNavigationGuard();
  const [active_tab, set_active_tab] = useState<string | null>(null);
  const requested_file_path = useChatUiStore((state) => state.files_panel_requested_file_path);
  const clear_requested_file = useChatUiStore((state) => state.clear_requested_workspace_file);

  useEffect(() => {
    const panel = panel_ref.current;
    if (!panel) return;
    if (!is_open) {
      panel.close();
      set_folder_path(null);
      return;
    }
    if (document.activeElement instanceof HTMLElement && !panel.contains(document.activeElement))
      opener_ref.current = document.activeElement;
    const compact = window.matchMedia('(max-width: 1279px)');
    let animation: Animation | undefined;
    const present_panel = () => {
      const focused = panel.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;
      if (panel.open) panel.close();
      animation?.cancel();
      if (compact.matches) {
        panel.showModal();
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          animation = panel.animate?.(
            [
              { opacity: 0, transform: 'translateX(12px)' },
              { opacity: 1, transform: 'translateX(0)' },
            ],
            { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          );
        }
      } else panel.show();
      panel.setAttribute('role', compact.matches ? 'dialog' : 'complementary');
      focused?.focus({ preventScroll: true });
    };
    present_panel();
    compact.addEventListener('change', present_panel);
    return () => {
      animation?.cancel();
      compact.removeEventListener('change', present_panel);
    };
  }, [is_open]);

  const open_file = useCallback(
    (file_path: string) => {
      const tabs = use_file_drafts.getState().tabs[workspace_id] ?? [];
      if (!tabs.includes(file_path) && tabs.length >= 12) {
        set_tab_notice('Close a file tab before opening another. You can open up to 12 files.');
        return;
      }
      set_tab_notice(null);
      set_tabs(workspace_id, tabs.includes(file_path) ? tabs : [...tabs, file_path]);
      set_active_tab(file_path);
    },
    [workspace_id, set_tabs],
  );

  useEffect(() => {
    if (!requested_file_path) return;
    set_mode('files');
    open_file(requested_file_path);
    clear_requested_file();
  }, [requested_file_path, open_file, clear_requested_file, set_mode]);

  const close_tab = async (file_path: string) => {
    const key = file_draft_key(workspace_id, file_path);
    if (drafts[key]?.saving) return;
    if (
      drafts[key]?.dirty &&
      !(await confirm_discard('Discard your unsaved changes and close this file?'))
    )
      return;
    set_draft(key, null);
    use_file_drafts.getState().reset_editor(key);
    const remaining = open_tabs.filter((tab) => tab !== file_path);
    if (active_tab === file_path) set_active_tab(remaining[remaining.length - 1] ?? null);
    set_tabs(workspace_id, remaining);
    set_tab_notice(null);
  };

  const showing_grid = mode === 'files' && active_tab === null;
  const showing_root_grid = showing_grid && folder_path === '';
  const step_back = () => {
    if (active_tab) return set_active_tab(null);
    set_folder_path(parent_folder_path(folder_path));
  };

  return (
    <dialog
      ref={panel_ref}
      aria-label="Workspace files and browser"
      onCancel={(event) => {
        event.preventDefault();
        close_panel();
      }}
      className={cn(
        'fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none flex-col border-0 bg-background p-0 text-foreground open:flex backdrop:bg-black/40 xl:z-10 xl:min-h-0 xl:border-l xl:border-border',
        expanded
          ? 'xl:fixed xl:inset-4 xl:z-50 xl:h-auto xl:w-auto xl:rounded-2xl xl:border xl:shadow-[0_0_0_100vmax_var(--scrim)]'
          : 'xl:relative xl:inset-auto xl:h-full xl:shadow-float',
      )}
    >
      {discard_dialog}
      {!expanded ? <FilesPanelWidthHandle /> : null}
      <header className="flex h-app-header min-h-12 items-center gap-2 border-b border-border px-3">
        {mode === 'files' && !showing_root_grid ? (
          <Button
            aria-label="Back"
            className="size-8 shrink-0"
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={step_back}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <PanelModeSwitch has_browser={has_browser} mode={mode} onChange={set_mode} />
        {mode === 'files' && !showing_root_grid ? (
          active_tab ? (
            <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {parent_folder_path(active_tab)}
            </div>
          ) : (
            <WorkspaceFolderBreadcrumb folderPath={folder_path} onNavigate={set_folder_path} />
          )
        ) : (
          <div className="flex-1" />
        )}
        <Button
          aria-label={expanded ? 'Restore panel' : 'Expand panel'}
          title={expanded ? 'Restore panel' : 'Expand panel'}
          className="hidden size-8 shrink-0 xl:inline-flex"
          size="icon-sm"
          variant="ghost"
          onClick={() => set_expanded(!expanded)}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          aria-label="Close panel"
          className="size-8 shrink-0"
          size="icon-sm"
          type="button"
          variant="ghost"
          onClick={close_panel}
        >
          <X />
        </Button>
      </header>
      {mode === 'browser' && is_open ? (
        file_views ? (
          file_views.browser
        ) : (
          <WorkspaceBrowserView
            key={session_id}
            previews={sandboxPreviews}
            session_id={session_id}
            browser_task={browser_task}
          />
        )
      ) : null}
      <div className={mode === 'files' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        {tab_notice ? (
          <p
            role="status"
            className="border-b border-border px-4 py-2 text-xs text-muted-foreground"
          >
            {tab_notice}
          </p>
        ) : null}
        <WorkspaceFileTabs
          activeTab={active_tab}
          onActivate={set_active_tab}
          onClose={close_tab}
          onNewTab={() => set_active_tab(null)}
          openTabs={open_tabs}
          dirtyTabs={open_tabs.filter(
            (file_path) => drafts[file_draft_key(workspace_id, file_path)]?.dirty,
          )}
        />
        {open_tabs
          .filter(
            (file_path) =>
              active_tab === file_path || drafts[file_draft_key(workspace_id, file_path)],
          )
          .map((file_path) => (
            <div
              key={file_path}
              className={active_tab === file_path ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
            >
              {file_views ? (
                file_views.render_file(file_path)
              ) : (
                <WorkspaceFileReader
                  filePath={file_path}
                  workspace_id={workspace_id}
                  active={is_open && mode === 'files' && active_tab === file_path}
                  onBrowseFiles={() => set_active_tab(null)}
                />
              )}
            </div>
          ))}
        {!active_tab && knows_where_to_open ? (
          file_views ? (
            file_views.render_listing({
              folderPath: folder_path,
              onOpenFile: open_file,
              onOpenFolder: set_folder_path,
            })
          ) : (
            <WorkspaceFilesGrid
              key={folder_path}
              workspace_id={workspace_id}
              folderPath={folder_path}
              onOpenFile={open_file}
              onOpenFolder={set_folder_path}
            />
          )
        ) : null}
      </div>
    </dialog>
  );
}

function PanelModeSwitch({
  has_browser,
  mode,
  onChange,
}: {
  has_browser: boolean;
  mode: PanelMode;
  onChange: (mode: PanelMode) => void;
}) {
  if (!has_browser) return <span className="shrink-0 px-1 font-medium text-sm">Files</span>;
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-2xl bg-sunken p-0.5">
      {(['files', 'browser'] as const).map((option) => (
        <button
          className={cn(
            'rounded-2xl px-3 py-1 text-xs font-medium capitalize transition-colors',
            mode === option
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={mode === option}
          key={option}
          type="button"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function parent_folder_path(folder_path: string) {
  const separator_index = folder_path.lastIndexOf('/');
  return separator_index === -1 ? '' : folder_path.slice(0, separator_index);
}
