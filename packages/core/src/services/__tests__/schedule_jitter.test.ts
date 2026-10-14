import { add_schedule_jitter } from '@coworker/core/services/schedule_jitter';
import { describe, expect, it } from 'vitest';

const scout_cron = '1 8,11,14,17 * * 1-5';
const discovery_cron = '0 9 * * 1';

describe('add_schedule_jitter', () => {
  it('gives a workspace the same minute every time it is asked', () => {
    const first = add_schedule_jitter({
      cron_expression: scout_cron,
      workspace_id: 'ws_ana',
      window: 'full_hour',
    });
    const second = add_schedule_jitter({
      cron_expression: scout_cron,
      workspace_id: 'ws_ana',
      window: 'full_hour',
    });

    expect(first).toBe(second);
    expect(first).toBe('2 8,11,14,17 * * 1-5');
  });

  it('spreads system schedules across the whole hour and keeps the rest of the cron', () => {
    const minutes = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const jittered = add_schedule_jitter({
        cron_expression: scout_cron,
        workspace_id: `ws_${index}`,
        window: 'full_hour',
      });
      const [minute, ...rest] = jittered.split(' ');
      expect(rest.join(' ')).toBe('8,11,14,17 * * 1-5');
      expect(Number(minute)).toBeGreaterThanOrEqual(0);
      expect(Number(minute)).toBeLessThan(60);
      minutes.add(minute ?? '');
    }

    expect(minutes.size).toBeGreaterThan(40);
  });

  it('keeps a user task inside five minutes of the time they asked for', () => {
    for (let index = 0; index < 200; index += 1) {
      const jittered = add_schedule_jitter({
        cron_expression: '0 9 * * *',
        workspace_id: `ws_${index}`,
        window: 'small_window',
      });
      const [minute, hour, ...rest] = jittered.split(' ');
      expect(hour).toBe('9');
      expect(rest.join(' ')).toBe('* * *');
      expect(Number(minute)).toBeLessThan(5);
    }
  });

  it('carries a small-window overflow into the next hour', () => {
    expect(
      add_schedule_jitter({
        cron_expression: '58 9 * * *',
        workspace_id: 'ws_ana',
        window: 'small_window',
      }),
    ).toBe('0 10 * * *');
  });

  it('wraps an hourly task without touching its wildcard hour', () => {
    expect(
      add_schedule_jitter({
        cron_expression: '58 * * * *',
        workspace_id: 'ws_ana',
        window: 'small_window',
      }),
    ).toBe('0 * * * *');
  });

  it('leaves an expression alone when the carry would move it to another day or hour set', () => {
    expect(
      add_schedule_jitter({
        cron_expression: '58 23 * * 1',
        workspace_id: 'ws_ana',
        window: 'small_window',
      }),
    ).toBe('58 23 * * 1');
    expect(
      add_schedule_jitter({
        cron_expression: '58 8,11 * * *',
        workspace_id: 'ws_ana',
        window: 'small_window',
      }),
    ).toBe('58 8,11 * * *');
  });

  it('only moves a plain numeric minute', () => {
    const untouched = [
      '*/4 * * * *',
      '0,30 9 * * *',
      '0-5 9 * * *',
      '* * * * *',
      'not a cron',
      '0 9 * *',
    ];
    for (const cron_expression of untouched) {
      expect(
        add_schedule_jitter({ cron_expression, workspace_id: 'ws_ana', window: 'full_hour' }),
      ).toBe(cron_expression);
      expect(
        add_schedule_jitter({ cron_expression, workspace_id: 'ws_ana', window: 'small_window' }),
      ).toBe(cron_expression);
    }
  });

  it('keeps a step hour intact while moving its plain minute', () => {
    expect(
      add_schedule_jitter({
        cron_expression: '0 */4 * * *',
        workspace_id: 'ws_carla',
        window: 'small_window',
      }),
    ).toBe('1 */4 * * *');
  });

  it('replaces rather than adds in the full-hour window', () => {
    expect(
      add_schedule_jitter({
        cron_expression: discovery_cron,
        workspace_id: 'ws_carla',
        window: 'full_hour',
      }),
    ).toBe('1 9 * * 1');
  });
});
