import { useMemo } from 'react';
import {
  read_onboarding_opening_text,
  reveal_onboarding_opening,
  useOnboardingIntro,
} from '@/components/app/chat_onboarding_intro';
import {
  read_session_onboarding_findings,
  session_is_onboarding_seeded,
} from '@/components/app/chat_onboarding_starters';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';
import type { RunMessage, Session } from '@/lib/api';

/** Plays the onboarding opening of a seeded chat and reads its starter findings. */
export function useChatOnboardingView(input: {
  session_id: string | undefined;
  selected_session: Session | undefined;
  visible_messages: RunMessage[];
  chat_messages: ProjectedChatMessage[];
}) {
  const { selected_session, visible_messages, chat_messages } = input;
  const onboarding_starter_findings = useMemo(
    () =>
      visible_messages.some((message) => message.message_role === 'user')
        ? []
        : read_session_onboarding_findings(selected_session),
    [selected_session, visible_messages],
  );
  const is_onboarding_opening = useMemo(
    () =>
      !visible_messages.some((message) => message.message_role === 'user') &&
      session_is_onboarding_seeded(selected_session),
    [selected_session, visible_messages],
  );
  const onboarding_intro = useOnboardingIntro({
    isEnabled: is_onboarding_opening,
    sessionId: input.session_id,
    textLength: is_onboarding_opening ? read_onboarding_opening_text(chat_messages).length : 0,
  });
  const is_onboarding_intro_playing =
    is_onboarding_opening &&
    (onboarding_intro.phase === 'thinking' || onboarding_intro.phase === 'typing');
  const revealed_chat_messages = is_onboarding_intro_playing
    ? reveal_onboarding_opening(chat_messages, onboarding_intro.revealed_characters)
    : chat_messages;
  return {
    onboarding_starter_findings,
    shows_onboarding_starters:
      onboarding_starter_findings.length > 0 && !is_onboarding_intro_playing,
    is_onboarding_intro_settled: onboarding_intro.phase === 'settled',
    is_onboarding_intro_playing,
    revealed_chat_messages,
  };
}
