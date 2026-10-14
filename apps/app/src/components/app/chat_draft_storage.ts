const chat_draft_storage_prefix = 'coworker-chat-draft-';

export const new_chat_draft_key = 'new';

export function chat_draft_key(session_id: string | null | undefined) {
  return session_id ?? new_chat_draft_key;
}

export function read_chat_draft(draft_key: string) {
  if (typeof window === 'undefined') return '';

  try {
    return window.localStorage.getItem(chat_draft_storage_prefix + draft_key) ?? '';
  } catch (error) {
    console.error(`Could not read the saved draft for ${draft_key}.`, error);
    return '';
  }
}

export function write_chat_draft(draft_key: string, draft: string) {
  if (typeof window === 'undefined') return;

  const storage_key = chat_draft_storage_prefix + draft_key;
  try {
    if (draft) window.localStorage.setItem(storage_key, draft);
    else window.localStorage.removeItem(storage_key);
  } catch (error) {
    console.error(`Could not save the draft for ${draft_key}.`, error);
  }
}
