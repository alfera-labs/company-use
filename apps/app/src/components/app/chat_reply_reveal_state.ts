import { useSyncExternalStore } from 'react';

const resume_window_ms = 5000;

let held_reply_count = 0;
let stopped_at_ms = 0;
let revealed = { text: '', at_ms: 0 };
const listeners = new Set<() => void>();

function tell_listeners() {
  for (const listener of listeners) listener();
}

function subscribe_to_held_replies(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks one reply as held back from the screen. Call the result when the hold ends. */
export function hold_reply_off_screen() {
  held_reply_count += 1;
  tell_listeners();
  return () => {
    held_reply_count -= 1;
    tell_listeners();
  };
}

export function useAnyReplyHeldOffScreen() {
  return useSyncExternalStore(
    subscribe_to_held_replies,
    () => held_reply_count > 0,
    () => false,
  );
}

export function remember_person_stopped_the_reply() {
  stopped_at_ms = Date.now();
}

export function person_stopped_the_reply_since(time_ms: number) {
  return stopped_at_ms >= time_ms;
}

export function remember_revealed_text(text: string) {
  revealed = { text, at_ms: Date.now() };
}

/**
 * How much of this text the reader has already seen typed a moment ago. A reply that mounts
 * again, when its saved copy replaces the live one, continues from there and does not type twice.
 */
export function already_revealed_length(full_text: string) {
  const is_recent = Date.now() - revealed.at_ms < resume_window_ms;
  return is_recent && revealed.text && full_text.startsWith(revealed.text)
    ? revealed.text.length
    : 0;
}
