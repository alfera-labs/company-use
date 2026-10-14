import {
  find_agent_path_style,
  generate_agent_visible_path,
} from '@agent-core/environment/agent_visible_path';
import type { SessionEnv } from '@agent-core/environment/session_env';
import { describe, expect, it } from 'vitest';

const sandbox_environment = make_environment({
  agent_tools_address_files_by: 'workspace_absolute_path',
  model_working_directory: '/workspace',
});
const local_environment = make_environment({
  agent_tools_address_files_by: 'working_directory_relative_path',
  model_working_directory: '/workspace',
});

describe('generate_agent_visible_path', () => {
  it('gives a sandbox the absolute path its tools expect', () => {
    expect(generate_agent_visible_path(sandbox_environment, 'tmp/attachments/art_1/deck.pdf')).toBe(
      '/workspace/tmp/attachments/art_1/deck.pdf',
    );
  });

  it('gives the local runtime a path relative to where its tools start', () => {
    expect(generate_agent_visible_path(local_environment, 'tmp/attachments/art_1/deck.pdf')).toBe(
      'tmp/attachments/art_1/deck.pdf',
    );
  });

  it('still climbs out when a working directory sits below the root', () => {
    const nested = {
      ...local_environment,
      metadata: {
        ...local_environment.metadata,
        model_working_directory: '/workspace/files',
      },
    } as typeof local_environment;

    expect(generate_agent_visible_path(nested, 'people/alice.md')).toBe('../people/alice.md');
  });

  it('accepts a canonical path written with a leading slash', () => {
    expect(generate_agent_visible_path(sandbox_environment, '/tmp/a/b.txt')).toBe(
      '/workspace/tmp/a/b.txt',
    );
  });

  it('falls back to absolute when an environment declares no style', () => {
    expect(find_agent_path_style(make_environment({}))).toBe('workspace_absolute_path');
    expect(find_agent_path_style(undefined)).toBe('workspace_absolute_path');
    expect(generate_agent_visible_path(undefined, 'tmp/a.txt')).toBe('/workspace/tmp/a.txt');
  });

  it('reads the style the environment declared', () => {
    expect(find_agent_path_style(local_environment)).toBe('working_directory_relative_path');
    expect(find_agent_path_style(sandbox_environment)).toBe('workspace_absolute_path');
  });
});

function make_environment(metadata: SessionEnv['metadata']): SessionEnv {
  return { env_key: 'test', env_kind: 'custom', ...(metadata ? { metadata } : {}) };
}
