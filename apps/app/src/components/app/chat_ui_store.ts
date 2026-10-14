import { create } from 'zustand';
import { let_alfera_recommend, type ModelChoice } from '@/components/app/model_picker/model_choice';

type ChatUiState = {
  model_choice: ModelChoice;
  selected_run_id_by_session: Record<string, string>;
  files_panel_open: boolean;
  files_panel_mode: 'files' | 'browser';
  files_panel_width: number;
  files_panel_requested_file_path: string | null;
  choice_panel_open: boolean;
  show_full_traces: boolean;
  set_choice_panel_open: (choice_panel_open: boolean) => void;
  set_show_full_traces: (show_full_traces: boolean) => void;
  set_model_choice: (model_choice: ModelChoice) => void;
  set_selected_run_id: (session_id: string, run_id: string) => void;
  set_files_panel_open: (files_panel_open: boolean) => void;
  set_files_panel_mode: (files_panel_mode: 'files' | 'browser') => void;
  set_files_panel_width: (files_panel_width: number) => void;
  open_workspace_file_in_panel: (file_path: string) => void;
  clear_requested_workspace_file: () => void;
};

const files_panel_width_storage_key = 'coworker.files_panel_width';
const files_panel_min_width = 380;
const files_panel_default_width = 560;

/** The chat beside the Files panel never gets narrower than this: its composer needs it. */
export const chat_min_width_beside_files_panel = 400;

/**
 * The width a person drags the Files panel to, held back so the chat keeps its minimum.
 * `room` is the width the chat and the panel share; without it the width is not held back.
 */
export function width_that_leaves_room_for_the_chat(wanted_width: number, room?: number) {
  if (!room) return wanted_width;
  return Math.min(wanted_width, room - chat_min_width_beside_files_panel);
}

function clamp_files_panel_width(width: number) {
  const max_width =
    typeof window === 'undefined' ? 900 : Math.min(1100, Math.round(window.innerWidth * 0.75));
  return Math.min(max_width, Math.max(files_panel_min_width, Math.round(width)));
}

function read_stored_files_panel_width() {
  if (typeof window === 'undefined') return files_panel_default_width;
  const stored = Number(window.localStorage.getItem(files_panel_width_storage_key));
  return Number.isFinite(stored) && stored > 0
    ? clamp_files_panel_width(stored)
    : files_panel_default_width;
}

export const useChatUiStore = create<ChatUiState>((set) => ({
  model_choice: let_alfera_recommend,
  selected_run_id_by_session: {},
  files_panel_open: false,
  files_panel_mode: 'files',
  files_panel_width: read_stored_files_panel_width(),
  files_panel_requested_file_path: null,
  choice_panel_open: false,
  show_full_traces: false,
  set_choice_panel_open: (choice_panel_open) => set({ choice_panel_open }),
  set_show_full_traces: (show_full_traces) => set({ show_full_traces }),
  set_model_choice: (model_choice) => set({ model_choice }),
  set_files_panel_open: (files_panel_open) => set({ files_panel_open }),
  set_files_panel_mode: (files_panel_mode) => set({ files_panel_mode }),
  open_workspace_file_in_panel: (file_path) =>
    set({
      files_panel_open: true,
      files_panel_mode: 'files',
      files_panel_requested_file_path: file_path,
    }),
  clear_requested_workspace_file: () => set({ files_panel_requested_file_path: null }),
  set_files_panel_width: (files_panel_width) => {
    const clamped = clamp_files_panel_width(files_panel_width);
    window.localStorage.setItem(files_panel_width_storage_key, String(clamped));
    set({ files_panel_width: clamped });
  },
  set_selected_run_id: (session_id, run_id) =>
    set((state) => ({
      selected_run_id_by_session: {
        ...state.selected_run_id_by_session,
        [session_id]: run_id,
      },
    })),
}));
