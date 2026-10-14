import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type AutomationHistoryRow,
  build_automation_history,
} from '@/components/app/automations/automation_sentences';
import {
  list_automation_fires,
  list_notifications,
} from '@/components/app/automations/automations_api';
import { relative_time } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function AutomationHistory({
  automationId,
  summaryTime,
}: {
  automationId: string;
  summaryTime: string | undefined;
}) {
  const fires_query = useQuery({
    queryKey: query_keys.automation_fires(automationId),
    queryFn: () => list_automation_fires(automationId, { page: 1, page_size: 20 }),
    refetchInterval: 15_000,
  });
  const notifications_query = useQuery({
    queryKey: query_keys.automation_notifications(automationId),
    queryFn: () => list_notifications({ automation_id: automationId, page_size: 20 }),
  });
  const rows = build_automation_history({
    fires: fires_query.data?.items ?? [],
    notifications: notifications_query.data?.items ?? [],
    summary_time: summaryTime,
  });

  if (fires_query.isError) return <p className="mt-6 text-sm">The history could not be loaded.</p>;
  if (rows.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        {fires_query.isLoading
          ? 'Reading the history.'
          : 'Nothing has started this yet. When something does, it shows up here and opens as a chat.'}
      </p>
    );
  }

  return <HistoryTable rows={rows} />;
}

function HistoryTable({ rows }: { rows: AutomationHistoryRow[] }) {
  return (
    <div className="mt-6 overflow-hidden rounded-3xl border bg-raised shadow-raised">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-3 font-normal">Started by</th>
            <th className="w-28 px-4 py-3 font-normal">When</th>
            <th className="w-[45%] px-4 py-3 font-normal">What happened</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <HistoryRow key={row.row_key} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({ row }: { row: AutomationHistoryRow }) {
  const navigate = useNavigate();
  const open_the_run = row.session_id
    ? () => {
        void navigate({
          to: '/chats/{-$session_id}',
          params: { session_id: row.session_id ?? '' },
        });
      }
    : undefined;
  return (
    <tr
      className={open_the_run ? 'cursor-pointer hover:bg-muted/40' : undefined}
      onClick={open_the_run}
    >
      <td className="px-4 py-3 align-top">
        {row.session_id ? (
          <Link
            className="underline-offset-4 hover:underline"
            to="/chats/{-$session_id}"
            params={{ session_id: row.session_id }}
          >
            {row.headline}
          </Link>
        ) : (
          row.headline
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 align-top text-muted-foreground">
        {relative_time(row.when)}
      </td>
      <td className="max-w-xl px-4 py-3 align-top [overflow-wrap:anywhere]">
        <HistorySentence row={row} />
      </td>
    </tr>
  );
}

function HistorySentence({ row }: { row: AutomationHistoryRow }) {
  const sentence = (
    <span className="line-clamp-3" title={row.sentence}>
      {row.sentence}
    </span>
  );
  if (!row.parked) return sentence;
  return (
    <Link
      className="underline-offset-4 hover:underline"
      to="/automations/ideas"
      onClick={(event) => event.stopPropagation()}
    >
      {sentence}
    </Link>
  );
}
