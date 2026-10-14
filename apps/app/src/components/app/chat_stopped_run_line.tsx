import { Button } from '@coworker/ui/components/button';
import { RotateCcw } from 'lucide-react';
import { useChatRunRecord } from '@/components/app/chat_run_records';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';

type TranscriptMessage = Pick<ProjectedChatMessage, 'run_id' | 'started_run_id'>;

/**
 * The line under a message whose run a person stopped before the coworker wrote anything. An
 * answer carries its own line. Without this one a stop in the first second leaves no trace in
 * the chat, and after a reload nothing says why the message has no answer. The last line of the
 * chat also offers to run the message again.
 */
export function StoppedRunLine({
  message,
  next,
  onRunAgain,
}: {
  message: TranscriptMessage;
  next: TranscriptMessage | undefined;
  onRunAgain: (() => void) | undefined;
}) {
  const run = useChatRunRecord(message.started_run_id);
  if (run?.run_status !== 'cancelled' || next?.run_id === run.run_id) return null;
  const run_again = next ? undefined : onRunAgain;
  return (
    <div className="flex w-full max-w-3xl items-center gap-1.5 px-6 pb-3">
      <p className="pl-0.5 text-[13px] leading-5 text-muted-foreground">
        {run_again ? 'Stopped. Send a message to go on.' : 'Stopped.'}
      </p>
      {run_again ? (
        <Button
          aria-label="Regenerate response"
          size="icon-xs"
          title="Run it again"
          type="button"
          variant="ghost"
          onClick={run_again}
        >
          <RotateCcw className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
