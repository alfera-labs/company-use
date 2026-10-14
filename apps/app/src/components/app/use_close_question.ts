// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.

import { useState } from 'react';

/**
 * Closes a dialog at once, or asks first when closing would lose what the person typed. The
 * dialog shows the question while `is_asking` is true, with "keep editing" and "close" as its
 * two answers.
 */
export type CloseQuestion = ReturnType<typeof use_close_question>;

export function use_close_question(input: {
  would_lose_what_was_typed: boolean;
  close: () => void;
}) {
  const [is_asking, set_is_asking] = useState(false);
  const close = () => {
    set_is_asking(false);
    input.close();
  };
  return {
    is_asking,
    close,
    keep_editing: () => set_is_asking(false),
    close_or_ask_first: () => (input.would_lose_what_was_typed ? set_is_asking(true) : close()),
  };
}
