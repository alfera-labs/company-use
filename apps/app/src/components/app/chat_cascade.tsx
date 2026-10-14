import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const cascade_batch_window_ms = 80;
const cascade_step_seconds = 0.12;
const cascade_max_delay_seconds = 0.6;

type CascadeBatch = { batchSize: number; batchTime: number };

type ChatCascade = {
  cascadeBatchRef: MutableRefObject<CascadeBatch>;
  hasPainted: boolean;
};

const chat_cascade_context = createContext<ChatCascade>({
  cascadeBatchRef: { current: { batchSize: 0, batchTime: 0 } },
  hasPainted: false,
});

/** Tells timeline items when the transcript has painted, so only later items cascade in. */
export function ChatCascadeProvider({
  transcript_id,
  children,
}: {
  transcript_id: string;
  children: ReactNode;
}) {
  const has_painted = useHasPaintedTranscript(transcript_id);
  const cascade_batch_ref = useRef<CascadeBatch>({ batchSize: 0, batchTime: 0 });
  const cascade = useMemo(
    () => ({ cascadeBatchRef: cascade_batch_ref, hasPainted: has_painted }),
    [has_painted],
  );

  return <chat_cascade_context.Provider value={cascade}>{children}</chat_cascade_context.Provider>;
}

export function useChatCascade() {
  return useContext(chat_cascade_context);
}

export function next_cascade_delay(cascade_batch_ref: MutableRefObject<CascadeBatch>) {
  const now = Date.now();
  const previous = cascade_batch_ref.current;
  const batch_size =
    now - previous.batchTime > cascade_batch_window_ms ? 0 : previous.batchSize + 1;
  cascade_batch_ref.current = { batchSize: batch_size, batchTime: now };
  return Math.min(batch_size * cascade_step_seconds, cascade_max_delay_seconds);
}

function useHasPaintedTranscript(transcript_id: string) {
  const [painted_id, set_painted_id] = useState('');

  useEffect(() => {
    set_painted_id(transcript_id);
  }, [transcript_id]);

  return transcript_id !== '' && painted_id === transcript_id;
}
