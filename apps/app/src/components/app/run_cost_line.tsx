import { cn } from '@coworker/ui/lib/utils';
import { useChatRunRecord } from '@/components/app/chat_run_records';
import { describe_run_cost } from '@/components/app/run_cost';

export type RunCostLineProps = {
  runId: string | undefined;
  revealsOnHover?: boolean;
};

/**
 * The quiet line that tells what the run of an answer used: model, tokens and provider cost.
 * It renders nothing for a run that is not in the chat or that used no tokens yet.
 */
export function RunCostLine({ runId, revealsOnHover = false }: RunCostLineProps) {
  const run = useChatRunRecord(runId);
  const summary = run ? describe_run_cost(run) : undefined;
  if (!summary) return null;

  return (
    <p
      className={cn(
        'pl-0.5 text-[12.5px] text-muted-foreground',
        revealsOnHover
          ? '-mt-1 leading-4 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100'
          : 'py-1 leading-5',
      )}
      data-run-cost-line
    >
      {summary}
    </p>
  );
}
