import { beforeEach, describe, expect, it } from 'vitest';
import { chat_draft_key, new_chat_draft_key } from '@/components/app/chat_draft_storage';
import { read_current_chat_draft, useChatDraftStore } from '@/components/app/chat_draft_store';

describe('chat draft store', () => {
  beforeEach(() => {
    install_browser_storage();
    useChatDraftStore.setState({ draft_by_key: {} });
  });

  it('keeps each chat draft under its own key', () => {
    useChatDraftStore.getState().set_draft('ses_1', 'first chat');
    useChatDraftStore.getState().set_draft('ses_2', 'second chat');

    expect(read_current_chat_draft('ses_1')).toBe('first chat');
    expect(read_current_chat_draft('ses_2')).toBe('second chat');
  });

  it('gives a chat that does not exist yet its own draft', () => {
    expect(chat_draft_key(undefined)).toBe(new_chat_draft_key);

    useChatDraftStore.getState().set_draft(new_chat_draft_key, 'a new task');
    expect(read_current_chat_draft(undefined)).toBe('a new task');
    expect(read_current_chat_draft('ses_1')).toBe('');
  });

  it('reads back a draft written before the page reloaded', () => {
    useChatDraftStore.getState().set_draft('ses_1', 'saved across reloads');
    useChatDraftStore.setState({ draft_by_key: {} });

    useChatDraftStore.getState().load_draft_from_storage('ses_1');
    expect(read_current_chat_draft('ses_1')).toBe('saved across reloads');
  });

  it('forgets a sent draft in memory and in storage', () => {
    useChatDraftStore.getState().set_draft('ses_1', 'about to send');
    useChatDraftStore.getState().clear_draft('ses_1');
    useChatDraftStore.setState({ draft_by_key: {} });

    useChatDraftStore.getState().load_draft_from_storage('ses_1');
    expect(read_current_chat_draft('ses_1')).toBe('');
  });

  it('leaves the action identities alone as drafts change', () => {
    const { clear_draft, set_draft } = useChatDraftStore.getState();
    set_draft('ses_1', 'typing');
    set_draft('ses_1', 'typing more');

    expect(useChatDraftStore.getState().set_draft).toBe(set_draft);
    expect(useChatDraftStore.getState().clear_draft).toBe(clear_draft);
  });
});

function install_browser_storage() {
  const stored_values = new Map<string, string>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => stored_values.get(key) ?? null,
        setItem: (key: string, value: string) => stored_values.set(key, value),
        removeItem: (key: string) => stored_values.delete(key),
      },
    },
  });
}
