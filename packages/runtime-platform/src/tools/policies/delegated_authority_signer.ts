import type { Database } from '@coworker/core';
import { find_api_key_by_id } from '@coworker/core/db/queries/api_keys';
import { id_prefixes, is_id, type RuntimeToolResult } from '@coworker/shared';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';

export async function find_dead_signature_error(
  db: Database,
  input: { node_key: string; source_metadata: RuntimeToolSourceMetadata | undefined },
): Promise<RuntimeToolResult | null> {
  const signer = input.source_metadata?.delegated_authority?.granted_by_actor_id;
  if (!signer || !is_id(signer, id_prefixes.api_key)) return null;

  const api_key = await find_api_key_by_id(db, signer);
  if (api_key?.key_status === 'active' && api_key.key_audience === 'internal') return null;

  const why = !api_key
    ? 'was deleted'
    : api_key.key_status !== 'active'
      ? `is ${api_key.key_status}`
      : 'is not an internal-audience key';
  return {
    success: false,
    error: {
      code: 'automation_signer_not_live',
      message: `${input.node_key} did not run: this automation was signed by an API key that ${why}, so its runs no longer carry authority to change things outside the workspace. Open the automation and save it again to sign it as yourself.`,
    },
    metadata: { node_key: input.node_key, signed_by: signer },
  };
}
