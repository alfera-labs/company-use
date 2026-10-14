import { create } from 'zustand';
import {
  chat_draft_key,
  read_chat_draft,
  write_chat_draft,
} from '@/components/app/chat_draft_storage';

type ChatDraftState = {
  draft_by_key: Record<string, string>;
  set_draft: (draft_key: string, draft: string) => void;
  clear_draft: (draft_key: string) => void;
  load_draft_from_storage: (draft_key: string) => void;
};

export const useChatDraftStore = create<ChatDraftState>((set) => ({
  draft_by_key: {},
  set_draft: (draft_key, draft) => {
    write_chat_draft(draft_key, draft);
    set((state) => ({ draft_by_key: { ...state.draft_by_key, [draft_key]: draft } }));
  },
  clear_draft: (draft_key) => {
    write_chat_draft(draft_key, '');
    set((state) => ({ draft_by_key: { ...state.draft_by_key, [draft_key]: '' } }));
  },
  load_draft_from_storage: (draft_key) =>
    set((state) => ({
      draft_by_key: { ...state.draft_by_key, [draft_key]: read_chat_draft(draft_key) },
    })),
}));

export function read_current_chat_draft(session_id: string | null | undefined) {
  return useChatDraftStore.getState().draft_by_key[chat_draft_key(session_id)] ?? '';
}
