import { useLayoutEffect, useRef } from 'react';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import type { PendingChatAttachment } from '@/components/app/chat_file_parts';
import { create_client_message_id } from '@/components/app/chat_optimistic_messages';
import { take_chat_route_handoff } from '@/components/app/chat_route_handoff';
import type { SendChatDraft } from '@/components/app/chat_send_draft';
import type { ChatWallCode } from '@/components/app/use_chat_paywall';

/**
 * Sends, once, the message another page handed to a new chat, unless the paywall blocks it. It
 * sends before the browser draws the new-chat page, so the person never sees that page between
 * the page they sent from and their message.
 */
export function useChatRouteHandoff(input: {
  session_id: string | undefined;
  draft_key: string;
  paywall: {
    effective_wall_code: ChatWallCode | null;
    is_wall_known: boolean;
    set_paywall_open: (open: boolean) => void;
  };
  send_message: { mutate: (draft: SendChatDraft) => void };
  set_attachments: (attachments: PendingChatAttachment[]) => void;
  set_project_id: (project_id: string | null) => void;
}) {
  const { session_id, draft_key, send_message, set_attachments, set_project_id } = input;
  const { effective_wall_code, is_wall_known, set_paywall_open } = input.paywall;
  const handoff_started_ref = useRef(false);
  const set_draft = useChatDraftStore((state) => state.set_draft);
  useLayoutEffect(() => {
    if (session_id || handoff_started_ref.current || !is_wall_known) return;
    const handoff = take_chat_route_handoff();
    if (!handoff) return;
    handoff_started_ref.current = true;
    set_draft(draft_key, handoff.message_text);
    set_attachments(handoff.attachments);
    if (handoff.project_id !== undefined) set_project_id(handoff.project_id);
    if (effective_wall_code) {
      set_paywall_open(true);
      return;
    }
    send_message.mutate({ ...handoff, client_message_id: create_client_message_id() });
  }, [
    draft_key,
    effective_wall_code,
    is_wall_known,
    send_message,
    session_id,
    set_attachments,
    set_draft,
    set_project_id,
    set_paywall_open,
  ]);
}
