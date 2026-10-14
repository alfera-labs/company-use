// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { useCallback, useEffect, useRef } from 'react';
import { write_text_as_if_typing } from '@/components/app/type_text_into_composer';

export function use_starter_prompt(input: {
  starter_prompt: string | null;
  message_text: string;
  set_message_text: (text: string) => void;
}) {
  const { starter_prompt, message_text, set_message_text } = input;
  const latest_text = useRef(message_text);
  latest_text.current = message_text;
  const cancel_typing = useRef<() => void>(() => {});

  const type_into_composer = useCallback(
    (full_text: string) => {
      cancel_typing.current();
      cancel_typing.current = write_text_as_if_typing({ full_text, write: set_message_text });
    },
    [set_message_text],
  );
  useEffect(() => () => cancel_typing.current(), []);

  useEffect(() => {
    if (!starter_prompt || latest_text.current.length > 0) return;
    type_into_composer(starter_prompt);
  }, [starter_prompt, type_into_composer]);

  return type_into_composer;
}
