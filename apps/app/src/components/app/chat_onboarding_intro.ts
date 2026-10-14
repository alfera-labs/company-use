import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';

export type OnboardingIntroPhase = 'idle' | 'thinking' | 'typing' | 'settled';

const intro_thinking_ms = 600;
const intro_typing_ms = 2800;
const intro_tick_ms = 45;

export function useOnboardingIntro({
  isEnabled,
  sessionId,
  textLength,
}: {
  isEnabled: boolean;
  sessionId: string | undefined;
  textLength: number;
}) {
  const reduce_motion = useReducedMotion();
  const [phase, set_phase] = useState<OnboardingIntroPhase>('idle');
  const [revealed_characters, set_revealed_characters] = useState(0);
  // Survives React's development double-invoke of this effect: the sessionStorage claim is spent
  // on the first pass, and without this the second pass would bail and leave the text hidden.
  const play_ref = useRef<IntroPlay>({});

  useEffect(() => {
    if (!isEnabled || !sessionId || textLength === 0 || reduce_motion) {
      end_intro_that_started(play_ref.current, sessionId);
      set_phase('idle');
      return;
    }
    if (!may_play_intro(play_ref.current, sessionId)) return;

    let characters = 0;
    let interval_id = 0;
    let thinking_timeout_id = 0;
    const chunk_size = Math.max(1, Math.ceil(textLength / (intro_typing_ms / intro_tick_ms)));
    const finish = () => {
      window.clearTimeout(thinking_timeout_id);
      window.clearInterval(interval_id);
      set_revealed_characters(textLength);
      set_phase('settled');
    };

    set_revealed_characters(0);
    set_phase('thinking');
    thinking_timeout_id = window.setTimeout(() => {
      interval_id = window.setInterval(() => {
        characters += chunk_size;
        if (characters >= textLength) return finish();
        set_revealed_characters(characters);
        set_phase('typing');
      }, intro_tick_ms);
    }, intro_thinking_ms);
    window.addEventListener('keydown', finish);

    return () => {
      window.clearTimeout(thinking_timeout_id);
      window.clearInterval(interval_id);
      window.removeEventListener('keydown', finish);
    };
  }, [isEnabled, reduce_motion, sessionId, textLength]);

  return { phase, revealed_characters };
}

type IntroPlay = { claimed_session_id?: string; ended_session_id?: string };

function end_intro_that_started(play: IntroPlay, session_id: string | undefined) {
  if (session_id && play.claimed_session_id === session_id) play.ended_session_id = session_id;
}

function may_play_intro(play: IntroPlay, session_id: string) {
  if (play.ended_session_id === session_id) return false;
  if (play.claimed_session_id !== session_id && !claim_onboarding_intro(session_id)) return false;
  play.claimed_session_id = session_id;
  return true;
}

function claim_onboarding_intro(session_id: string) {
  try {
    const key = `ob_intro_played:${session_id}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

export function read_onboarding_opening_text(messages: ProjectedChatMessage[]) {
  return messages
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    .join('');
}

export function reveal_onboarding_opening(
  messages: ProjectedChatMessage[],
  revealed_characters: number,
): ProjectedChatMessage[] {
  if (revealed_characters === 0) return [];
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'text' ? { ...part, text: whole_words(part.text, revealed_characters) } : part,
    ),
  }));
}

function whole_words(text: string, character_count: number) {
  if (character_count >= text.length) return text;
  const next_space = text.indexOf(' ', character_count);
  return next_space === -1 ? text : text.slice(0, next_space);
}
