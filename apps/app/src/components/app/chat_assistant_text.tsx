import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChatCascade } from '@/components/app/chat_cascade';
import {
  chat_markdown_class_name,
  chat_markdown_streamdown_class_name,
} from '@/components/app/chat_message';
import {
  person_stopped_the_reply_since,
  useAnyReplyHeldOffScreen,
} from '@/components/app/chat_reply_reveal_state';
import { useMeteredText } from '@/components/app/use_metered_text';
import { MessageContent } from '@/components/prompt-kit/message';

const fade_finish_ms = 400;
const longest_wait_for_reply_ms = 4000;

/** The text of one assistant reply. A new reply types out, and its new words fade in. */
export function ChatAssistantText({ text, is_streaming }: { text: string; is_streaming: boolean }) {
  const is_new_reply = useChatCascade().hasPainted;
  const metered = useMeteredText({ full_text: text, is_streaming, is_new_reply });
  const fades_new_words = useStaysTrueFor(metered.is_revealing, fade_finish_ms);
  if (!metered.text) return null;

  return (
    <MessageContent
      className={chat_markdown_class_name}
      markdown
      streaming={fades_new_words}
      streamdownClassName={chat_markdown_streamdown_class_name}
    >
      {metered.text}
    </MessageContent>
  );
}

/**
 * True while the reader still waits for a reply that the run no longer announces: the run is
 * marked finished before its text is on the screen, or the first words are held back.
 */
export function useReplyStillDue(is_submitting: boolean, last_message_role: string | undefined) {
  const reply_is_held = useAnyReplyHeldOffScreen();
  const [run_just_ended, set_run_just_ended] = useState(false);
  const submitted_at_ms = useRef(0);

  useEffect(() => {
    if (is_submitting) {
      submitted_at_ms.current = Date.now();
      return set_run_just_ended(false);
    }
    if (!submitted_at_ms.current || person_stopped_the_reply_since(submitted_at_ms.current)) return;
    submitted_at_ms.current = 0;
    set_run_just_ended(true);
    const timer = setTimeout(() => set_run_just_ended(false), longest_wait_for_reply_ms);
    return () => clearTimeout(timer);
  }, [is_submitting]);

  return reply_is_held || (run_just_ended && last_message_role === 'user');
}

function useStaysTrueFor(value: boolean, linger_ms: number) {
  const [stays_true, set_stays_true] = useState(false);
  useLayoutEffect(() => {
    if (value) return set_stays_true(true);
    const timer = setTimeout(() => set_stays_true(false), linger_ms);
    return () => clearTimeout(timer);
  }, [value, linger_ms]);
  return stays_true;
}
