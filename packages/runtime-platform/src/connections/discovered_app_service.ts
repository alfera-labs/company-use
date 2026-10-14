import {
  type DiscoveredSignIn,
  validate_discovered_sign_in,
} from '@coworker/core/credentials/discovered_sign_in';
import { resolve_host_addresses } from '@coworker/core/credentials/resolve_host_addresses';
import { find_website_icon } from '@coworker/core/credentials/website_icon';
import type { Database } from '@coworker/core/db/connection';
import { set_connection_resume_intent } from '@coworker/core/db/queries/connection_management';
import {
  find_app_awaiting_credentials,
  insert_discovered_app,
} from '@coworker/core/db/queries/discovered_apps';
import type { ConnectionResumeIntentData } from '@coworker/core/db/schema/json_column_types';

export type DiscoveredAppOutcome =
  | { created: true; app_id: string; connection_id: string; asks_for: string[] }
  | { created: false; because: string };

export async function create_app_awaiting_credentials(input: {
  db: Database;
  workspace_id: string;
  actor_id: string;
  discovered: DiscoveredSignIn;
  resume?: ConnectionResumeIntentData | undefined;
}): Promise<DiscoveredAppOutcome> {
  const verdict = await validate_discovered_sign_in({
    discovered: input.discovered,
    lookup_addresses: resolve_host_addresses,
  });
  if (!verdict.accepted) return { created: false, because: verdict.because };

  const existing = await find_app_awaiting_credentials(input.db, {
    workspace_id: input.workspace_id,
    website_host: verdict.allowed_hosts[0] as string,
  });
  if (existing) {
    await record_resume_intent(input.db, { ...input, connection_id: existing.connection_id });
    return {
      created: true,
      app_id: existing.app_id,
      connection_id: existing.connection_id,
      asks_for: ask_for_labels(input.discovered),
    };
  }

  const icon_url =
    input.discovered.logo_url ??
    (await find_website_icon({ host: verdict.allowed_hosts[0] as string }));

  const created = await insert_discovered_app(input.db, {
    workspace_id: input.workspace_id,
    created_by: input.actor_id,
    app_display_name: input.discovered.app_display_name,
    allowed_hosts: verdict.allowed_hosts,
    ...(icon_url ? { logo_url: icon_url } : {}),
    exchange_the_credential_by: {
      exchange_kind: 'api_login',
      stop_after_failed_attempts: 1,
      recipe: input.discovered.recipe,
    },
    sign_in_name_label: input.discovered.sign_in_name_label,
    could_not_determine: input.discovered.could_not_determine,
  });

  await record_resume_intent(input.db, { ...input, connection_id: created.connection_id });
  return { created: true, ...created, asks_for: ask_for_labels(input.discovered) };
}

async function record_resume_intent(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    resume?: ConnectionResumeIntentData | undefined;
    actor_id: string;
  },
) {
  if (!input.resume) return;
  await set_connection_resume_intent(db, { ...input, resume: input.resume });
}

function ask_for_labels(discovered: DiscoveredSignIn): string[] {
  return [discovered.sign_in_name_label, 'Password'];
}
