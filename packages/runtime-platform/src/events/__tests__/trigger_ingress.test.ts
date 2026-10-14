import {
  prepare_trigger_fire_event,
  read_trigger_schedule,
  type TriggerRow,
} from '@runtime-platform/events/trigger_ingress';
import { describe, expect, it } from 'vitest';

const base = {
  trigger_id: 'trg_1',
  workspace_id: 'ws_1',
  trigger_type: 'schedule',
  schedule_expression: '0 9 * * *',
  trigger_config: {},
} as unknown as TriggerRow;

describe('read_trigger_schedule', () => {
  it('returns null for a non-schedule trigger even if it has a cron expression', () => {
    expect(read_trigger_schedule({ ...base, trigger_type: 'webhook' })).toBeNull();
  });

  it('returns null for a schedule trigger with no cron expression', () => {
    expect(read_trigger_schedule({ ...base, schedule_expression: null })).toBeNull();
  });

  it('reads the cron and maps the timezone from trigger_config', () => {
    const schedule = read_trigger_schedule({
      ...base,
      trigger_config: { timezone: 'Europe/Rome' },
    });
    expect(schedule).toEqual({
      trigger_id: 'trg_1',
      cron_expression: '0 9 * * *',
      timezone: 'Europe/Rome',
    });
  });

  it('omits timezone when trigger_config has none', () => {
    expect(read_trigger_schedule(base)).toEqual({
      trigger_id: 'trg_1',
      cron_expression: '0 9 * * *',
    });
  });
});

describe('prepare_trigger_fire_event', () => {
  it('returns null when the trigger has no starts_job_handler', () => {
    expect(prepare_trigger_fire_event(base, { occurrence_key: 'k' })).toBeNull();
  });

  it('builds a trigger.fired event keyed by occurrence and carrying the job handler', () => {
    const trigger = {
      ...base,
      trigger_config: { starts_job_handler: 'daily_digest', job_input: { scope: 'team' } },
    } as TriggerRow;
    const prepared = prepare_trigger_fire_event(trigger, { occurrence_key: '2026-06-13T09:00' });

    expect(prepared?.queue_key).toBe('trigger:trg_1');
    expect(prepared?.event).toMatchObject({
      workspace_id: 'ws_1',
      source: 'trigger',
      source_event_id: 'trg_1:2026-06-13T09:00',
      event_type: 'trigger.fired',
      actor_key: 'system:trigger',
      event_body: { trigger_id: 'trg_1', scope: 'team' },
      event_jobs: [{ job_handler: 'daily_digest' }],
    });
  });
});
