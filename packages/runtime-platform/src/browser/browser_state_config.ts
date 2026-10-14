import { createHash, createHmac } from 'node:crypto';
import { env } from '@coworker/config';
import { AppError } from '@coworker/shared';

export type BrowserStateConfig = {
  session_name: string;
  command_env: Record<string, string>;
};

export function create_browser_state_config(input: {
  volume_id: string;
  encryption_key?: string;
  node_env?: 'development' | 'test' | 'production';
}): BrowserStateConfig {
  const master_key = browser_state_master_key(input);
  const session_name = browser_session_name(input.volume_id);
  const encryption_key = createHmac('sha256', Buffer.from(master_key, 'hex'))
    .update(`coworker-browser-state:${input.volume_id}`)
    .digest('hex');

  return {
    session_name,
    command_env: {
      AGENT_BROWSER_SESSION: session_name,
      AGENT_BROWSER_RESTORE: session_name,
      AGENT_BROWSER_ENCRYPTION_KEY: encryption_key,
      AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: '15000',
    },
  };
}

function browser_state_master_key(input: {
  encryption_key?: string;
  node_env?: 'development' | 'test' | 'production';
}) {
  const encryption_key = input.encryption_key ?? env.COWORKER_BROWSER_STATE_ENCRYPTION_KEY;
  if (encryption_key) return encryption_key.toLowerCase();
  if ((input.node_env ?? env.NODE_ENV) === 'production') {
    throw new AppError(
      'browser_state_encryption_not_configured',
      'COWORKER_BROWSER_STATE_ENCRYPTION_KEY is required for persistent browser state.',
      500,
    );
  }

  return createHash('sha256').update('coworker-local-development-browser-state-key').digest('hex');
}

function browser_session_name(volume_id: string) {
  return `coworker_${volume_id}`.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 120);
}

export function create_browser_live_view_token(input: {
  sandbox_id: string;
  encryption_key?: string;
  node_env?: 'development' | 'test' | 'production';
}): string {
  const master_key = browser_state_master_key(input);
  return createHmac('sha256', Buffer.from(master_key, 'hex'))
    .update(`coworker-browser-live-view:${input.sandbox_id}`)
    .digest('hex');
}
