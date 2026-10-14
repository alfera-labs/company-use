import { read_current_chat_draft, useChatDraftStore } from '@/components/app/chat_draft_store';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import type { SendChatDraft } from '@/components/app/chat_send_draft';
import type { ChatWallCode } from '@/components/app/use_chat_paywall';

type ChatMessageInput = {
  attachments: PendingChatAttachment[];
  message_text: string;
  project_id?: string | null;
};

/**
 * Sends from the composer, a starter, or a template; the composer answers an open question
 * first. Runs the last message again for "Regenerate". The paywall stops each of them.
 */
export function useChatSendActions(input: {
  session_id: string | undefined;
  draft_key: string;
  project_id: string | null;
  attachments: PendingChatAttachment[];
  effective_wall_code: ChatWallCode | null;
  set_paywall_open: (open: boolean) => void;
  send_message: { mutate: (draft: SendChatDraft) => void };
  run_again: () => void;
  client_message_id_for_draft: () => string;
  choice_panel_open: boolean;
  answer_choice_panel: (answer_text: string) => Promise<boolean>;
}) {
  const { session_id, project_id } = input;
  const clear_draft = useChatDraftStore((state) => state.clear_draft);
  async function send_chat_message(message: ChatMessageInput) {
    if (input.effective_wall_code) {
      input.set_paywall_open(true);
      return;
    }
    input.send_message.mutate({
      ...message,
      ...(!session_id
        ? { project_id: message.project_id === undefined ? project_id : message.project_id }
        : {}),
      client_message_id: input.client_message_id_for_draft(),
    });
  }
  async function send_from_composer() {
    const message_text = read_current_chat_draft(session_id).trim();
    if (input.choice_panel_open && message_text) {
      if (await input.answer_choice_panel(message_text)) clear_draft(input.draft_key);
      return;
    }
    await send_chat_message({ attachments: input.attachments, message_text, project_id });
  }
  function run_last_message_again() {
    if (input.effective_wall_code) return input.set_paywall_open(true);
    input.run_again();
  }
  return { send_chat_message, send_from_composer, run_last_message_again };
}
