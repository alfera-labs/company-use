import { describe, expect, it, vi } from 'vitest';

const daily_summary = vi.fn(async () => ({ job_status: 'done', result_data: { summarized: 2 } }));
const watchdog = vi.fn(async () => {
  throw new Error('composio is down');
});
const calendar = vi.fn(async () => ({ job_status: 'done', result_data: { fired: [] } }));
const miner = vi.fn(async () => ({ job_status: 'done', result_data: { ran: true } }));
vi.mock('@runtime-platform/events/daily_summary_job', () => ({
  run_daily_summary_job: daily_summary,
}));
vi.mock('@runtime-platform/events/automation_watchdog_job', () => ({
  run_automation_watchdog_job: watchdog,
}));
vi.mock('@runtime-platform/events/calendar_offset_sweep_job', () => ({
  run_calendar_offset_sweep_job: calendar,
}));
vi.mock('@runtime-platform/events/automation_miner_job', () => ({
  run_automation_miner_job: miner,
}));
vi.mock('@runtime-platform/events/system_trigger_fire', () => ({
  read_fired_system_trigger: async () => ({
    trigger: { trigger_config: { timezone: 'Europe/London' } },
  }),
  system_job_skipped: (message: string, code: string) => ({
    job_status: 'done',
    result_data: { ran: false, code, message },
  }),
}));

const { run_attention_tick_job } = await import('@runtime-platform/events/attention_tick_job');

describe('run_attention_tick_job', () => {
  it('runs every chore and a failing one does not stop the rest', async () => {
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    const result = await run_attention_tick_job({
      db: { select } as never,
      workspace_id: 'ws_1',
      events: [],
      now: new Date('2026-09-20T17:00:00Z'),
    });
    expect(result.result_data).toMatchObject({
      ran: true,
      daily_summary: { summarized: 2 },
      watchdog: { failed: 'composio is down' },
      calendar: { fired: [] },
      miner: { ran: true },
    });
    expect(daily_summary).toHaveBeenCalledTimes(1);
    expect(miner).toHaveBeenCalledTimes(1);
  });

  it('does not mine on a Tuesday', async () => {
    miner.mockClear();
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    const result = await run_attention_tick_job({
      db: { select } as never,
      workspace_id: 'ws_1',
      events: [],
      now: new Date('2026-09-22T17:00:00Z'),
    });
    expect(result.result_data).toMatchObject({ miner: { code: 'not_mining_time' } });
    expect(miner).not.toHaveBeenCalled();
  });
});
