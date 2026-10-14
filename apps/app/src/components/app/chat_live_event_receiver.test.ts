import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { create_live_event_receiver } from '@/components/app/chat_live_event_receiver';
import { query_keys } from '@/lib/api/query_keys';
import type { Run } from '@/lib/api/types';

const finished = { run_id: 'run_old', run_status: 'completed' } as Run;
const started = { run_id: 'run_new', run_status: 'running' } as Run;

function receiver_with_runs(runs: Run[]) {
  const query_client = new QueryClient();
  query_client.setQueryData(query_keys.runs('ses_1'), runs);
  const receiver = create_live_event_receiver({
    session_id: 'ses_1',
    query_client,
    on_run_announced: () => {},
  });
  const read_runs = () => query_client.getQueryData<Run[]>(query_keys.runs('ses_1'));
  return { receiver, read_runs };
}

describe('the live event receiver', () => {
  it('shows a new run the moment the socket announces it, before any refetch', () => {
    const { receiver, read_runs } = receiver_with_runs([finished]);
    receiver.receive({ type: 'run_created', run: started });
    expect(read_runs()?.map((run) => run.run_id)).toEqual(['run_new', 'run_old']);
  });

  it('updates a known run in place', () => {
    const { receiver, read_runs } = receiver_with_runs([started, finished]);
    receiver.receive({ type: 'run_updated', run: { ...started, run_status: 'completed' } });
    expect(read_runs()?.map((run) => [run.run_id, run.run_status])).toEqual([
      ['run_new', 'completed'],
      ['run_old', 'completed'],
    ]);
  });
});
