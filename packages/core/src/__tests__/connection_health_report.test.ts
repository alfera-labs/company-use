import { generate_connection_health_report } from '@coworker/core/integrations/connection_health_report';
import { describe, expect, it } from 'vitest';

const rejected_connection = {
  connection_name: 'Gmail (info@example.com)',
  health_status: 'unhealthy',
  last_checked_time: new Date('2026-08-06T09:15:00Z'),
  connection_config: {
    credential_rejected_time: '2026-08-06T09:15:00.000Z',
    credential_rejected_detail: 'Invalid Credentials',
  },
};

describe('generate_connection_health_report', () => {
  it('keeps a provider rejection instead of laundering it to healthy', () => {
    const report = generate_connection_health_report(rejected_connection);

    expect(report.health_status).toBe('unhealthy');
    expect(report.credential_rejected_detail).toBe('Invalid Credentials');
    expect(report.credential_rejected_time).toBe('2026-08-06T09:15:00.000Z');
    expect(report.summary).toContain('reconnected');
  });

  it('reports a never-used connection as unknown rather than healthy', () => {
    const report = generate_connection_health_report({
      connection_name: 'Notion',
      health_status: null,
      last_checked_time: null,
      connection_config: {},
    });

    expect(report.health_status).toBe('unknown');
    expect(report.last_verified_time).toBeNull();
    expect(report.summary).toContain('not been used');
  });

  it('does not claim a healthy connection was re-tested', () => {
    const report = generate_connection_health_report({
      connection_name: 'Google Drive',
      health_status: 'healthy',
      last_checked_time: new Date('2026-08-07T12:00:00Z'),
      connection_config: {},
    });

    expect(report.health_status).toBe('healthy');
    expect(report.summary).toContain('nothing was re-tested');
  });

  it('survives a connection_config that is not an object', () => {
    for (const connection_config of [null, undefined, 'nonsense', 42]) {
      const report = generate_connection_health_report({
        connection_name: 'Slack',
        health_status: 'unhealthy',
        last_checked_time: null,
        connection_config,
      });
      expect(report.health_status).toBe('unhealthy');
      expect(report.credential_rejected_detail).toBeNull();
    }
  });

  it('names the connection even when it has no name', () => {
    const report = generate_connection_health_report({
      connection_name: null,
      health_status: 'unhealthy',
      last_checked_time: null,
      connection_config: {},
    });

    expect(report.summary.startsWith('This connection')).toBe(true);
  });
});
