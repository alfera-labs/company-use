import { AppError } from '@coworker/shared';
import type { WorkspaceVolumeAddress } from '@runtime-platform/files/workspace_volume_browser';
import * as volume_browser from '@runtime-platform/files/workspace_volume_browser';
import {
  default_notification_rules,
  forget_notification_rules_file,
  parse_notification_rules_text,
  read_notification_rules_file,
  read_notification_rules_guidance,
} from '@runtime-platform/notifications/notification_rules_file';
import { save_notification_rules_file } from '@runtime-platform/notifications/save_notification_rules';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it, vi } from 'vitest';

const address: WorkspaceVolumeAddress = {
  volume_id: 'vol_test',
  provider_volume_id: 'pv_test',
  region: undefined,
  volume_workspace_path: 'agents/agt_test',
  layout: current_workspace_layout,
};

const policy_file = [
  '---',
  'dial: quiet',
  'quiet_hours: 21:00-06:30 Europe/London',
  'max_notifications_per_day: 2',
  'daily_summary: weekdays 07:15 -> email',
  'delivery_channel_order: [email, web]',
  'always_notify: [flight-watch]',
  'never_notify: [competitor-news]',
  'own_daily_limit: { flight-watch: 20 }',
  '---',
  '',
  '# How I want you to behave',
  '',
  '- Fundraise threads are always worth interrupting me for.',
  '',
].join('\n');

const older_policy_file = [
  '---',
  'mode: quiet',
  'max_notifications_per_day: 2',
  'daily_summary_at_time: "07:15"',
  'delivery_channel_order: [email, web]',
  'quiet_hours:',
  '  start: "21:00"',
  '  end: "06:30"',
  '  timezone: Europe/London',
  'automation_overrides:',
  '  atm_invoices: always_notify',
  '---',
  '',
  '# Notification rules',
  '',
  'Ask me in chat to change any of this.',
  '',
].join('\n');

const db = {} as never;

function db_with_heartbeat_timezone(timezone: string | null) {
  return {
    query: {
      connections: {
        findMany: async () => [{ external_account_name: 'studio@example.com', app_id: 'gmail' }],
      },
      triggers: {
        findMany: async () =>
          timezone === null
            ? []
            : [
                {
                  trigger_config: { provisioning_key: 'workspace_heartbeat_v1', timezone },
                },
              ],
      },
    },
  } as never;
}

function readers(file_text: string | null) {
  return {
    resolve_address: vi.fn(async () => address),
    read_file: vi.fn(async () => {
      if (file_text === null) {
        throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
      }
      return new TextEncoder().encode(file_text);
    }),
  };
}

describe('read_notification_rules_file', () => {
  it('reads the settings a person wrote, one-line quiet hours and own_daily_limit included', async () => {
    const read = await read_notification_rules_file(
      db,
      { workspace_id: 'ws', agent_id: 'agt' },
      readers(policy_file),
    );
    expect(read.policy).toEqual({
      dial: 'quiet',
      ignore: [],
      triage_calls_per_day: 300,
      quiet_hours: { start: '21:00', end: '06:30', timezone: 'Europe/London' },
      max_notifications_per_day: 2,
      daily_summary_cadence: 'weekdays',
      daily_summary_at_time: '07:15',
      daily_summary_channel: 'email',
      delivery_channel_order: ['email', 'web'],
      always_notify: ['flight-watch'],
      never_notify: ['competitor-news'],
      own_daily_limit: { 'flight-watch': 20 },
    });
    expect(read.parse_failed).toBe(false);
    expect(read.policy_hash).toHaveLength(64);
  });

  it('still reads the keys the tool wrote before the file had this shape', () => {
    const { policy, parse_failed } = parse_notification_rules_text(older_policy_file);
    expect(parse_failed).toBe(false);
    expect(policy.dial).toBe('quiet');
    expect(policy.quiet_hours).toEqual({ start: '21:00', end: '06:30', timezone: 'Europe/London' });
    expect(policy.always_notify).toEqual(['atm_invoices']);
  });

  it('clamps every number to its code ceiling, so the file can never mint attention', () => {
    const greedy = parse_notification_rules_text(
      ['---', 'max_notifications_per_day: 400', 'own_daily_limit: { pager: 99 }', '---'].join('\n'),
    );
    expect(greedy.policy.max_notifications_per_day).toBe(15);
    expect(greedy.policy.own_daily_limit.pager).toBe(30);
  });

  it('answers with the default policy when there is no file and when there is no volume', async () => {
    const missing_file = await read_notification_rules_file(
      db,
      { workspace_id: 'ws', agent_id: 'agt' },
      readers(null),
    );
    expect(missing_file).toEqual({
      policy: default_notification_rules,
      policy_hash: 'default',
      file_text: null,
      parse_failed: false,
      read_failed: false,
    });

    const no_volume = await read_notification_rules_file(
      db,
      { workspace_id: 'ws', agent_id: 'agt' },
      { resolve_address: vi.fn(async () => null) },
    );
    expect(no_volume.policy).toEqual(default_notification_rules);
  });

  it('defaults to quiet hours, so nothing interrupts at 03:00 by omission', () => {
    expect(default_notification_rules.quiet_hours).toEqual({
      start: '19:00',
      end: '08:00',
      timezone: 'UTC',
    });
  });

  it('refuses a timezone no clock knows, in both shapes a person writes it', () => {
    const one_line = parse_notification_rules_text('---\nquiet_hours: 19:00-08:00 Foo/Bar\n---\n');
    const written_out = parse_notification_rules_text(
      '---\nquiet_hours:\n  start: "19:00"\n  end: "08:00"\n  timezone: Foo/Bar\n---\n',
    );
    const real_one = parse_notification_rules_text(
      '---\nquiet_hours: 19:00-08:00 Europe/London\n---\n',
    );

    expect(one_line.parse_failed).toBe(true);
    expect(one_line.policy).toEqual(default_notification_rules);
    expect(written_out.parse_failed).toBe(true);
    expect(real_one.parse_failed).toBe(false);
    expect(real_one.policy.quiet_hours?.timezone).toBe('Europe/London');
  });

  it('falls back to the default over a broken file, and says so rather than going quiet', () => {
    const broken = parse_notification_rules_text('---\ndial: screaming\n---\n');
    expect(broken.policy).toEqual(default_notification_rules);
    expect(broken.parse_failed).toBe(true);

    const prose_only = parse_notification_rules_text('no frontmatter here');
    expect(prose_only.policy).toEqual(default_notification_rules);
    expect(prose_only.parse_failed).toBe(false);
  });
});

describe('a volume that will not answer', () => {
  it('answers with the defaults and says the read failed, instead of failing the run', async () => {
    const read = await read_notification_rules_file(db, { workspace_id: 'ws', agent_id: 'agt' }, {
      resolve_address: vi.fn(async () => address),
      read_file: vi.fn(async () => {
        throw new AppError(
          'workspace_volume_unavailable',
          'Workspace files are not reachable right now.',
          503,
        );
      }),
    } as never);

    expect(read.policy).toEqual(default_notification_rules);
    expect(read.read_failed).toBe(true);
    expect(read.parse_failed).toBe(false);
    expect(read.read_failed_reason).toContain('not reachable');
  });
});

describe('the held answer', () => {
  const cached_agent = { workspace_id: 'ws_cache', agent_id: 'agt_cache' };
  const volume = {
    resolve_address: async () => address,
    read_file: async () => new TextEncoder().encode(policy_file),
  };

  it('answers twice from one read, and reads again after a minute', async () => {
    forget_notification_rules_file(cached_agent);
    const read_file = vi.fn(volume.read_file);
    vi.spyOn(volume_browser, 'resolve_workspace_volume_address').mockImplementation(
      async () => address,
    );
    vi.spyOn(volume_browser, 'read_workspace_volume_file').mockImplementation(read_file);
    const start = new Date('2026-09-16T10:00:00Z');

    await read_notification_rules_file(db, cached_agent, {}, start);
    await read_notification_rules_file(db, cached_agent, {}, new Date(start.getTime() + 59_000));
    expect(read_file).toHaveBeenCalledTimes(1);

    await read_notification_rules_file(db, cached_agent, {}, new Date(start.getTime() + 61_000));
    expect(read_file).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('never holds a failed read: the next write asks the volume again', async () => {
    forget_notification_rules_file(cached_agent);
    const read_file = vi
      .fn(volume.read_file)
      .mockRejectedValueOnce(new Error('the volume is not reachable'));
    vi.spyOn(volume_browser, 'resolve_workspace_volume_address').mockImplementation(
      async () => address,
    );
    vi.spyOn(volume_browser, 'read_workspace_volume_file').mockImplementation(read_file);
    const start = new Date('2026-09-16T10:00:00Z');

    const failed = await read_notification_rules_file(db, cached_agent, {}, start);
    const next = await read_notification_rules_file(db, cached_agent, {}, start);

    expect(failed.read_failed).toBe(true);
    expect(next.read_failed).toBe(false);
    expect(next.policy.dial).toBe('quiet');
    vi.restoreAllMocks();
  });

  it('is dropped the moment the dial is saved, so the next read sees the new file', async () => {
    forget_notification_rules_file(cached_agent);
    const written = { text: policy_file };
    const read_file = vi.fn(async () => new TextEncoder().encode(written.text));
    vi.spyOn(volume_browser, 'resolve_workspace_volume_address').mockImplementation(
      async () => address,
    );
    vi.spyOn(volume_browser, 'read_workspace_volume_file').mockImplementation(read_file);
    vi.spyOn(volume_browser, 'replace_workspace_volume_file').mockImplementation(
      async (_address, input) => {
        written.text = new TextDecoder().decode(input.data);
        return undefined as never;
      },
    );
    const start = new Date('2026-09-16T10:00:00Z');

    const before = await read_notification_rules_file(db, cached_agent, {}, start);
    await save_notification_rules_file(db, {
      ...cached_agent,
      changes: { dial: 'eager' },
      changed_by: 'usr_alex',
      now: start,
    });
    const after = await read_notification_rules_file(db, cached_agent, {}, start);

    expect(before.policy.dial).toBe('quiet');
    expect(after.policy.dial).toBe('eager');
    expect(after.policy.max_notifications_per_day).toBe(2);
    vi.restoreAllMocks();
  });
});

describe('a volume that lags and drops writes', () => {
  const written_agent = { workspace_id: 'ws_lag', agent_id: 'agt_lag' };

  function stale_volume() {
    vi.spyOn(volume_browser, 'resolve_workspace_volume_address').mockImplementation(
      async () => address,
    );
    vi.spyOn(volume_browser, 'read_workspace_volume_file').mockImplementation(async () =>
      new TextEncoder().encode(policy_file),
    );
  }

  it('answers with what it just wrote, instead of the file the volume still hands back', async () => {
    forget_notification_rules_file(written_agent);
    stale_volume();
    vi.spyOn(volume_browser, 'replace_workspace_volume_file').mockImplementation(
      async () => undefined as never,
    );
    const start = new Date('2026-09-16T10:00:00Z');

    const saved = await save_notification_rules_file(db, {
      ...written_agent,
      changes: { dial: 'eager' },
      changed_by: 'usr_alex',
      now: start,
    });
    const after = await read_notification_rules_file(db, written_agent, {}, start);

    expect(saved.policy.dial).toBe('eager');
    expect(after.policy.dial).toBe('eager');
    expect(after.parse_failed).toBe(false);
    vi.restoreAllMocks();
  });

  it('asks again when the provider drops the write, and merges over what is there now', async () => {
    forget_notification_rules_file(written_agent);
    stale_volume();
    const replace_file = vi.fn(async () => {
      if (replace_file.mock.calls.length < 3) {
        throw new AppError(
          'workspace_storage_temporarily_unavailable',
          'Workspace files are not reachable right now.',
          503,
        );
      }
      return undefined as never;
    });
    vi.spyOn(volume_browser, 'replace_workspace_volume_file').mockImplementation(replace_file);

    const saved = await save_notification_rules_file(db, {
      ...written_agent,
      changes: { dial: 'eager' },
      changed_by: 'usr_alex',
      now: new Date('2026-09-16T10:00:00Z'),
    });

    expect(saved.policy.dial).toBe('eager');
    expect(replace_file).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it('gives up with the provider error it got, when every attempt fails', async () => {
    forget_notification_rules_file(written_agent);
    stale_volume();
    const replace_file = vi.fn(async (): Promise<never> => {
      throw new AppError(
        'workspace_storage_temporarily_unavailable',
        'Workspace files are not reachable right now.',
        503,
      );
    });
    vi.spyOn(volume_browser, 'replace_workspace_volume_file').mockImplementation(replace_file);

    await expect(
      save_notification_rules_file(db, {
        ...written_agent,
        changes: { dial: 'eager' },
        changed_by: 'usr_alex',
      }),
    ).rejects.toThrow('not reachable');
    expect(replace_file).toHaveBeenCalledTimes(6);
    vi.restoreAllMocks();
  });
});

describe('read_notification_rules_guidance', () => {
  it('hands back the prose under the settings, which is what a run reads before it scores', async () => {
    const guidance = await read_notification_rules_guidance(
      db,
      { workspace_id: 'ws', agent_id: 'agt' },
      readers(policy_file),
    );
    expect(guidance).toContain('Fundraise threads are always worth interrupting me for.');
    expect(guidance).not.toContain('dial: quiet');

    expect(
      await read_notification_rules_guidance(
        db,
        { workspace_id: 'ws', agent_id: 'agt' },
        readers(null),
      ),
    ).toBe('');
  });
});

describe('save_notification_rules_file', () => {
  it('rewrites only the named settings, keeps the prose, and logs who changed what', async () => {
    const replace_file = vi.fn(
      async (_address: WorkspaceVolumeAddress, _input: { file_path: string; data: Uint8Array }) =>
        undefined,
    );
    const saved = await save_notification_rules_file(
      db,
      {
        workspace_id: 'ws',
        agent_id: 'agt',
        changes: { dial: 'eager', max_notifications_per_day: undefined },
        changed_by: 'usr_alex',
        now: new Date('2026-09-15T10:00:00Z'),
      },
      { ...readers(policy_file), replace_file },
    );

    expect(saved.policy.dial).toBe('eager');
    expect(saved.policy.max_notifications_per_day).toBe(2);
    expect(saved.policy.quiet_hours?.timezone).toBe('Europe/London');
    expect(saved.policy.own_daily_limit).toEqual({ 'flight-watch': 20 });

    const written = new TextDecoder().decode(replace_file.mock.calls[0]?.[1].data);
    expect(written).toContain('dial: eager');
    expect(written).toContain('quiet_hours: 21:00-06:30 Europe/London');
    expect(written).toContain('daily_summary: weekdays 07:15 -> email');
    expect(written).toContain('own_daily_limit: { flight-watch: 20 }');
    expect(written).toContain('Fundraise threads are always worth interrupting me for.');
    expect(written).toContain('- 2026-09-15: dial changed by usr_alex');
    expect(parse_notification_rules_text(written).policy).toEqual(saved.policy);
  });

  it('refuses to patch a file it cannot read, rather than resetting the keys nobody named', async () => {
    const broken_file = policy_file.replace(
      'daily_summary: weekdays 07:15 -> email',
      'daily_summary: pigeon',
    );
    const replace_file = vi.fn(async () => undefined);

    await expect(
      save_notification_rules_file(
        db,
        {
          workspace_id: 'ws',
          agent_id: 'agt',
          changes: { dial: 'eager' },
          changed_by: 'usr_alex',
        },
        { ...readers(broken_file), replace_file },
      ),
    ).rejects.toThrow(/notification-rules.md has a setting nobody can read/u);
    expect(replace_file).not.toHaveBeenCalled();
  });

  it('writes the prose a person edited in the dashboard', async () => {
    const replace_file = vi.fn(
      async (_address: WorkspaceVolumeAddress, _input: { file_path: string; data: Uint8Array }) =>
        undefined,
    );
    await save_notification_rules_file(
      db,
      {
        workspace_id: 'ws',
        agent_id: 'agt',
        changes: {},
        guidance: '# How I want you to behave\n\n- Never ping me about newsletters.',
        changed_by: 'usr_alex',
        now: new Date('2026-09-15T10:00:00Z'),
      },
      { ...readers(policy_file), replace_file },
    );
    const written = new TextDecoder().decode(replace_file.mock.calls[0]?.[1].data);
    expect(written).toContain('- Never ping me about newsletters.');
    expect(written).not.toContain('Fundraise threads');
    expect(written).toContain('the prose changed by usr_alex');
  });

  it('creates the file, with its opening words, when there is none yet', async () => {
    const write_file = vi.fn(
      async (_address: WorkspaceVolumeAddress, _input: { file_path: string; data: Uint8Array }) =>
        undefined,
    );
    await save_notification_rules_file(
      db_with_heartbeat_timezone(null),
      { workspace_id: 'ws', agent_id: 'agt', changes: { dial: 'off' }, changed_by: 'usr_alex' },
      { ...readers(null), write_file },
    );
    const written = new TextDecoder().decode(write_file.mock.calls[0]?.[1].data);
    expect(written).toContain('dial: off');
    expect(written).toContain('quiet_hours: 19:00-08:00 UTC');
    expect(written).toContain('# Notification rules');
    expect(written).toContain('ignore: [sender address_is_not_any_of studio@example.com,');
    expect(written).toContain('payload.headers header_missing List-Unsubscribe');
  });

  it('stamps the workspace timezone on the quiet hours it creates', async () => {
    const write_file = vi.fn(
      async (_address: WorkspaceVolumeAddress, _input: { file_path: string; data: Uint8Array }) =>
        undefined,
    );
    const saved = await save_notification_rules_file(
      db_with_heartbeat_timezone('Europe/London'),
      { workspace_id: 'ws', agent_id: 'agt', changes: { dial: 'normal' }, changed_by: 'usr' },
      { ...readers(null), write_file },
    );
    expect(saved.policy.quiet_hours?.timezone).toBe('Europe/London');
    const written = new TextDecoder().decode(write_file.mock.calls[0]?.[1].data);
    expect(written).toContain('quiet_hours: 19:00-08:00 Europe/London');
  });

  it('refuses when the workspace has no volume to keep the file on', async () => {
    await expect(
      save_notification_rules_file(
        db,
        { workspace_id: 'ws', agent_id: 'agt', changes: { dial: 'off' }, changed_by: 'usr' },
        { resolve_address: vi.fn(async () => null) },
      ),
    ).rejects.toThrow('no files volume');
  });
});

describe('quiet hours written as a word', () => {
  it('reads none, off and a blank as no quiet hours', async () => {
    const { notification_rules_fields } = await import(
      '@runtime-platform/notifications/notification_rules_schema'
    );
    for (const word of ['none', 'off', 'empty', '']) {
      expect(notification_rules_fields.parse({ quiet_hours: word }).quiet_hours).toBeNull();
    }
    expect(notification_rules_fields.parse({ quiet_hours: '19:00-08:00 UTC' }).quiet_hours).toEqual(
      {
        start: '19:00',
        end: '08:00',
        timezone: 'UTC',
      },
    );
  });
});

describe('notification_rules_timezone', () => {
  it('keeps the workspace zone when quiet hours are switched off', async () => {
    const { notification_rules_fields, notification_rules_timezone } = await import(
      '@runtime-platform/notifications/notification_rules_schema'
    );
    const policy = notification_rules_fields.parse({
      timezone: 'Europe/London',
      quiet_hours: 'none',
    });
    expect(policy.quiet_hours).toBeNull();
    expect(notification_rules_timezone(policy)).toBe('Europe/London');
    expect(
      notification_rules_timezone(
        notification_rules_fields.parse({ quiet_hours: '19:00-08:00 Europe/Paris' }),
      ),
    ).toBe('Europe/Paris');
    expect(
      notification_rules_timezone(notification_rules_fields.parse({ quiet_hours: 'off' })),
    ).toBe('UTC');
  });
});
