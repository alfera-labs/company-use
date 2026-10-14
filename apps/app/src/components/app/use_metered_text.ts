import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  already_revealed_length,
  hold_reply_off_screen,
  remember_revealed_text,
} from '@/components/app/chat_reply_reveal_state';

const backlog_clear_ms = 350;
const slowest_chars_per_second = 120;
const fastest_chars_per_second = 900;
const longest_step_ms = 120;
const first_words_hold_chars = 24;
const longest_first_words_hold_ms = 2500;
const first_words_hold_after_reply_ends_ms = 800;
const chars_that_read_as_started = 12;

/**
 * Reveals a new reply at a steady pace. Text arrives from the network in bursts, so each tick
 * shows a share of what is still hidden: a large burst types out fast, and the tail slows to a
 * calm drip. A reply that was on the page when the transcript first painted shows at once.
 *
 * The first word of a reply often arrives alone, well before the rest, and the run can be marked
 * finished before the rest arrives. So the first words stay off the screen until more text is
 * there, and the end of the run does not release them at once.
 */
export function useMeteredText(input: {
  full_text: string;
  is_streaming: boolean;
  is_new_reply: boolean;
}) {
  const { full_text, is_streaming } = input;
  const [shown_length, set_shown_length] = useState(full_text.length);
  const types_out = useRef(is_streaming || input.is_new_reply);
  const last_step_at = useRef(0);
  if (is_streaming) types_out.current = true;
  const target_length = full_text.length;
  const is_behind = shown_length < target_length;
  const holds_first_words = useFirstWordsHold(types_out.current, is_streaming, target_length);
  const has_barely_started = is_behind && shown_length < chars_that_read_as_started;
  const is_off_screen = holds_first_words || (types_out.current && has_barely_started);

  useEffect(() => {
    if (is_off_screen) return hold_reply_off_screen();
  }, [is_off_screen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the reply first mounts
  useLayoutEffect(() => {
    if (types_out.current) set_shown_length(already_revealed_length(full_text));
  }, []);

  useEffect(() => {
    if (!is_behind || holds_first_words) return;
    if (!types_out.current || shows_text_at_once()) return set_shown_length(target_length);
    const tick_ms = reveal_tick_ms(target_length);
    const timer = setTimeout(() => {
      const now = performance.now();
      const since_last_step_ms = now - last_step_at.current;
      last_step_at.current = now;
      const elapsed_ms = since_last_step_ms > longest_step_ms ? tick_ms : since_last_step_ms;
      const next_length = next_shown_length(full_text, shown_length, elapsed_ms);
      remember_revealed_text(full_text.slice(0, next_length));
      set_shown_length(next_length);
    }, tick_ms);
    return () => clearTimeout(timer);
  }, [full_text, holds_first_words, is_behind, shown_length, target_length]);

  return {
    text: is_behind ? full_text.slice(0, shown_length) : full_text,
    is_revealing: is_streaming || is_behind,
  };
}

function useFirstWordsHold(types_out: boolean, is_streaming: boolean, text_length: number) {
  const [hold_is_over, set_hold_is_over] = useState(!types_out);
  const holds = !hold_is_over && text_length < first_words_hold_chars;

  useEffect(() => {
    if (hold_is_over) return;
    const wait_ms = is_streaming
      ? longest_first_words_hold_ms
      : first_words_hold_after_reply_ends_ms;
    const timer = setTimeout(() => set_hold_is_over(true), wait_ms);
    return () => clearTimeout(timer);
  }, [hold_is_over, is_streaming]);

  return holds;
}

export function next_shown_length(full_text: string, shown_length: number, elapsed_ms: number) {
  const backlog = full_text.length - shown_length;
  const chars_per_second = Math.min(
    fastest_chars_per_second,
    Math.max(slowest_chars_per_second, (backlog * 1000) / backlog_clear_ms),
  );
  const step = Math.ceil((chars_per_second * elapsed_ms) / 1000);
  const next_length = Math.min(full_text.length, shown_length + step);
  return splits_a_character_pair(full_text, next_length) ? next_length + 1 : next_length;
}

function reveal_tick_ms(text_length: number) {
  if (text_length < 4000) return 32;
  return text_length < 16_000 ? 64 : 96;
}

function splits_a_character_pair(text: string, length: number) {
  const code = text.charCodeAt(length);
  return length < text.length && code >= 0xdc00 && code <= 0xdfff;
}

function shows_text_at_once() {
  return document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
