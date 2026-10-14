import { createContext, useContext } from 'react';
import type { Run } from '@/lib/api';

const no_runs: readonly Run[] = [];

const ChatRunRecordsContext = createContext<readonly Run[]>(no_runs);

/** Puts the runs of the chat on screen in reach of every answer in it. */
export const ChatRunRecordsProvider = ChatRunRecordsContext.Provider;

/** The record of one run of the chat on screen, or undefined when the chat does not hold it. */
export function useChatRunRecord(run_id: string | undefined) {
  const runs = useContext(ChatRunRecordsContext);
  return run_id ? runs.find((run) => run.run_id === run_id) : undefined;
}
