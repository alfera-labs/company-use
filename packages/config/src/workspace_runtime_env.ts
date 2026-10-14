import { boolean_env_schema } from '@coworker/config/env_value_schemas';
import { z } from 'zod';

const self_hosted_schema = boolean_env_schema.default(false);

function default_workspace_runtime_provider() {
  const runs_tests = process.env.NODE_ENV === 'test';
  return runs_tests || self_hosted_schema.parse(process.env.COWORKER_SELF_HOSTED)
    ? 'docker'
    : 'e2b';
}

export const workspace_runtime_env_schema = {
  COWORKER_SELF_HOSTED: self_hosted_schema,
  COWORKER_WORKSPACE_RUNTIME_PROVIDER: z
    .enum(['local', 'docker', 'e2b'])
    .default(default_workspace_runtime_provider()),
  COWORKER_SANDBOX_NETWORK: z.string().trim().min(1).default('alfera-sandbox'),
  COWORKER_SANDBOX_PRIVATE_ADDRESSES: z.enum(['closed', 'open']).default('closed'),
  COWORKER_SANDBOX_DNS: z.string().trim().min(1).default('1.1.1.1,9.9.9.9'),
  COWORKER_MCP_PRIVATE_ADDRESSES: z.enum(['closed', 'open']).default('closed'),
};

/**
 * What the operator of this install decided about MCP servers on a private address. Only a
 * self-hosted install can open them, and only COWORKER_MCP_PRIVATE_ADDRESSES=open does.
 */
export function read_private_mcp_server_setting(): 'not_self_hosted' | 'closed' | 'open' {
  const self_hosted = self_hosted_schema.safeParse(process.env.COWORKER_SELF_HOSTED || undefined);
  if (self_hosted.data !== true) return 'not_self_hosted';
  return process.env.COWORKER_MCP_PRIVATE_ADDRESSES === 'open' ? 'open' : 'closed';
}
