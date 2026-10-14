export type ConnectionHealthReport = {
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  last_verified_time: Date | null;
  credential_rejected_time: string | null;
  credential_rejected_detail: string | null;
  summary: string;
};

type ConnectionHealthFacts = {
  connection_name: string | null;
  health_status: string | null;
  last_checked_time: Date | null;
  connection_config: unknown;
};

export function generate_connection_health_report(
  connection: ConnectionHealthFacts,
): ConnectionHealthReport {
  const rejection = read_credential_rejection(connection.connection_config);
  const health_status = read_health_status(connection.health_status);
  const name = connection.connection_name || 'This connection';
  return {
    health_status,
    last_verified_time: connection.last_checked_time,
    credential_rejected_time: rejection.time,
    credential_rejected_detail: rejection.detail,
    summary: summarize_connection_health(name, health_status, rejection),
  };
}

function read_health_status(recorded: string | null): ConnectionHealthReport['health_status'] {
  if (recorded === 'healthy' || recorded === 'unhealthy') return recorded;
  return 'unknown';
}

function summarize_connection_health(
  connection_name: string,
  health_status: ConnectionHealthReport['health_status'],
  rejection: { time: string | null; detail: string | null },
): string {
  if (health_status === 'unhealthy') {
    const because = rejection.detail ? ` The provider said: ${rejection.detail}` : '';
    const when = rejection.time ? ` on ${rejection.time}` : '';
    return `${connection_name} was rejected by the provider${when}, so it will not run until it is reconnected.${because}`;
  }
  if (health_status === 'healthy') {
    return `${connection_name} worked the last time it was used. This reports what was recorded then; nothing was re-tested just now.`;
  }
  return `${connection_name} has not been used yet, so there is nothing recorded either way. Run something with it to find out.`;
}

function read_credential_rejection(connection_config: unknown): {
  time: string | null;
  detail: string | null;
} {
  if (connection_config === null || typeof connection_config !== 'object') {
    return { time: null, detail: null };
  }
  const config = connection_config as Record<string, unknown>;
  return {
    time:
      typeof config.credential_rejected_time === 'string' ? config.credential_rejected_time : null,
    detail:
      typeof config.credential_rejected_detail === 'string'
        ? config.credential_rejected_detail
        : null,
  };
}
