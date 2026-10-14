import type { ComponentProps } from 'react';
import { ChatConversation } from '@/components/app/chat_conversation';
import { ChatRunRecordsProvider } from '@/components/app/chat_run_records';
import { is_chat_run_active } from '@/components/app/chat_session_state';
import type { Run } from '@/lib/api';

const no_runs: readonly Run[] = [];

/**
 * The conversation of a chat, from the runs of the chat, newest first. The newest run is the
 * active one while it works, and every answer can read the record of its own run.
 */
export function ChatConversationWithRuns({
  runs = no_runs,
  ...conversation
}: Omit<ComponentProps<typeof ChatConversation>, 'activeRunId'> & {
  runs: readonly Run[] | undefined;
}) {
  const [newest_run] = runs;
  const is_newest_run_active = is_chat_run_active(newest_run?.run_status);

  return (
    <ChatRunRecordsProvider value={runs}>
      <ChatConversation
        {...conversation}
        {...(newest_run && is_newest_run_active ? { activeRunId: newest_run.run_id } : {})}
      />
    </ChatRunRecordsProvider>
  );
}
