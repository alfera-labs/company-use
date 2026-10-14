import { useEffect } from 'react';
import { create } from 'zustand';

type FileDraft = {
  original_text: string | null;
  text: string | null;
  content_version: string;
  dirty: boolean;
  saving?: boolean;
};

type FileDraftState = {
  drafts: Record<string, FileDraft>;
  tabs: Record<string, string[]>;
  generations: Record<string, number>;
  reset_editor: (key: string) => void;
  set_draft: (key: string, draft: FileDraft | null) => void;
  set_tabs: (workspace_id: string, tabs: string[]) => void;
};

export const use_file_drafts = create<FileDraftState>((set) => ({
  drafts: {},
  tabs: {},
  generations: {},
  reset_editor: (key) =>
    set((state) => ({
      generations: { ...state.generations, [key]: (state.generations[key] ?? 0) + 1 },
    })),
  set_draft: (key, draft) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (draft) drafts[key] = draft;
      else delete drafts[key];
      return { drafts };
    }),
  set_tabs: (workspace_id, tabs) =>
    set((state) => ({ tabs: { ...state.tabs, [workspace_id]: tabs } })),
}));

export function file_draft_key(workspace_id: string, file_path: string) {
  return JSON.stringify([workspace_id, file_path]);
}

function has_unsaved_file_drafts() {
  return Object.values(use_file_drafts.getState().drafts).some((draft) => draft.dirty);
}

let navigation_guard_installed = false;

export function useFileNavigationGuard() {
  useEffect(() => {
    if (navigation_guard_installed) return;
    navigation_guard_installed = true;
    const before_unload = (event: BeforeUnloadEvent) => {
      if (!has_unsaved_file_drafts()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const follow_link = (event: MouseEvent) => {
      if (!has_unsaved_file_drafts() || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.download || link.target === '_blank' || event.metaKey || event.ctrlKey)
        return;
      const destination = new URL(link.href, window.location.href);
      if (
        destination.pathname === window.location.pathname &&
        destination.origin === window.location.origin
      )
        return;
      if (window.confirm('You have unsaved file changes. Leave this page?')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('beforeunload', before_unload);
    document.addEventListener('click', follow_link, true);
  }, []);
}
