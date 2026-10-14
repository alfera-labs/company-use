// The door: hand E2B the headers it should staple onto the sandbox's requests.
//
// The credential never enters the sandbox. E2B terminates TLS at its own egress
// proxy and adds the header there, so curl, python, node, Chrome and anything
// else in the machine make an ordinary unauthenticated request and the vendor
// receives an authenticated one. Nothing inside can read the value, and nothing
// inside has to be taught to send it.
//
// Two things about E2B's API are easy to get wrong and are handled here:
//   · `allowOut` is deliberately never set. Absent means "all egress allowed";
//     setting it would silently restrict the sandbox to credential hosts alone
//     and break npm, git and every other ordinary fetch.
//   · `updateNetwork` REPLACES the whole rule set, so the full set is always sent.
import type { Database } from '@coworker/core';
import { plan_egress_headers } from '@coworker/core/credentials/egress_header_rules';
import { list_credentials_to_deliver } from '@coworker/core/db/queries/connection_credential_delivery';
import { create_logger } from '@coworker/shared';
import { Sandbox } from 'e2b';

const logger = create_logger('sandbox-credentials');

export type SandboxNetworkRules = Record<
  string,
  [{ transform: { headers: Record<string, string> } }]
>;

export async function generate_sandbox_network_rules(input: {
  db: Database;
  workspace_id: string;
  now?: Date | undefined;
}): Promise<SandboxNetworkRules | null> {
  const plan = plan_egress_headers(
    await list_credentials_to_deliver(input.db, {
      workspace_id: input.workspace_id,
      now: input.now ?? new Date(),
    }),
  );

  for (const refusal of plan.could_not_be_attached) {
    logger.warn(
      `credential not attached to sandbox egress: ${refusal.connection_name} -> ${refusal.host}: ${refusal.because}`,
    );
  }

  const hosts = Object.keys(plan.headers_by_host);
  if (hosts.length === 0) return null;

  logger.info(`attaching credentials to sandbox egress for ${hosts.length} host(s)`);
  return Object.fromEntries(
    hosts.map((host) => [
      host,
      [{ transform: { headers: plan.headers_by_host[host] as Record<string, string> } }],
    ]),
  );
}

// The rules this process last applied to each sandbox. updateNetwork reconfigures the
// sandbox's network layer while it runs, cutting every socket a live Chrome holds open —
// the browser then times out right after a refresh that reported success.
// Rules are derived deterministically from DB state, so when the
// newly computed set equals what we last applied, the sandbox already has it and the call
// is pure downside. A cross-instance cache miss just re-applies (today's behavior).
const last_applied_rules_by_sandbox = new Map<string, string>();

export async function attach_credentials_to_running_sandbox(input: {
  db: Database;
  workspace_id: string;
  provider_sandbox_id: string;
}): Promise<{ hosts: string[]; network_reconfigured: boolean }> {
  const rules = await generate_sandbox_network_rules(input);
  const hosts = Object.keys(rules ?? {});

  const rules_fingerprint = JSON.stringify(rules ?? {});
  if (last_applied_rules_by_sandbox.get(input.provider_sandbox_id) === rules_fingerprint) {
    logger.info(
      `sandbox ${input.provider_sandbox_id} already carries the current rules for ${hosts.join(', ') || '(none)'}; skipping network update`,
    );
    return { hosts, network_reconfigured: false };
  }

  if (hosts.length === 0) {
    logger.warn(
      `clearing every credential rule on sandbox ${input.provider_sandbox_id}: workspace ${input.workspace_id} has nothing deliverable right now`,
    );
  } else {
    logger.info(
      `attaching credentials to sandbox ${input.provider_sandbox_id} for ${hosts.join(', ')}`,
    );
  }

  await Sandbox.updateNetwork(input.provider_sandbox_id, { rules: rules ?? {} });
  last_applied_rules_by_sandbox.set(input.provider_sandbox_id, rules_fingerprint);
  return { hosts, network_reconfigured: true };
}
