import { randomBytes } from 'node:crypto';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  claim_workspace_inbound_email_username,
  find_workspace_inbound_email_username,
  rename_workspace_inbound_email_username,
} from '@coworker/core/db/queries/workspace_inbound_email';
import { find_workspace_profile } from '@coworker/core/db/queries/workspace_provisioning';
import { AppError } from '@coworker/shared';
import {
  build_inbound_email_address,
  default_inbound_email_username,
  reserved_inbound_email_usernames,
} from '@runtime-platform/channels/email/inbound_address';

export type WorkspaceEmailAddress = {
  email_address: string;
  created: boolean;
};

export async function create_workspace_email_address(
  db: Database,
  input: { workspace_id: string; username?: string; actor_id: string },
): Promise<WorkspaceEmailAddress> {
  if (!env.INBOUND_EMAIL_DOMAIN) {
    throw new AppError(
      'inbound_email_domain_unconfigured',
      'Managed email is not enabled for this environment (INBOUND_EMAIL_DOMAIN is unset).',
      409,
    );
  }

  const existing = await find_workspace_inbound_email_username(db, input.workspace_id);
  if (existing) {
    if (input.username && input.username.toLowerCase() !== existing) {
      throw new AppError(
        'email_username_already_set',
        `This workspace already has the email username "${existing}". Change it with PATCH /v1/workspace/email-address.`,
        409,
      );
    }
    return { email_address: build_inbound_email_address(existing), created: false };
  }

  const username = input.username ?? (await default_username_for_workspace(db, input.workspace_id));
  if (reserved_inbound_email_usernames.has(username.toLowerCase())) {
    throw new AppError(
      'email_username_reserved',
      `The email username "${username}" is reserved.`,
      409,
    );
  }

  const claimed = input.username
    ? await claim_workspace_inbound_email_username(db, {
        workspace_id: input.workspace_id,
        username,
        actor_id: input.actor_id,
      })
    : await claim_username_with_suffix_on_collision(db, {
        workspace_id: input.workspace_id,
        username,
        actor_id: input.actor_id,
      });
  return { email_address: build_inbound_email_address(claimed), created: true };
}

const collision_suffix_attempts = 5;
const collision_suffix_bytes = 2;

async function claim_username_with_suffix_on_collision(
  db: Database,
  input: { workspace_id: string; username: string; actor_id: string },
): Promise<string> {
  let candidate = input.username;
  for (let attempt = 0; attempt < collision_suffix_attempts; attempt++) {
    try {
      return await claim_workspace_inbound_email_username(db, { ...input, username: candidate });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'email_username_taken') throw error;
      candidate = append_username_suffix(input.username);
    }
  }
  throw new AppError(
    'email_username_taken',
    'Could not find a free email address for this workspace. Choose one explicitly.',
    409,
  );
}

function append_username_suffix(username: string): string {
  const suffix = randomBytes(collision_suffix_bytes).toString('hex');
  return `${username.slice(0, 64 - suffix.length - 1)}-${suffix}`;
}

export async function rename_workspace_email_address(
  db: Database,
  input: { workspace_id: string; username: string; actor_id: string },
): Promise<WorkspaceEmailAddress> {
  if (!env.INBOUND_EMAIL_DOMAIN) {
    throw new AppError(
      'inbound_email_domain_unconfigured',
      'Managed email is not enabled for this environment (INBOUND_EMAIL_DOMAIN is unset).',
      409,
    );
  }
  if (reserved_inbound_email_usernames.has(input.username.toLowerCase())) {
    throw new AppError(
      'email_username_reserved',
      `The email username "${input.username}" is reserved.`,
      409,
    );
  }
  const renamed = await rename_workspace_inbound_email_username(db, input);
  return { email_address: build_inbound_email_address(renamed), created: false };
}

export async function find_workspace_email_address(db: Database, workspace_id: string) {
  const available = Boolean(env.INBOUND_EMAIL_DOMAIN);
  const username = await find_workspace_inbound_email_username(db, workspace_id);
  return {
    email_address: available && username ? build_inbound_email_address(username) : null,
    available,
  };
}

async function default_username_for_workspace(db: Database, workspace_id: string) {
  const workspace = await find_workspace_profile(db, workspace_id);
  if (!workspace) throw new AppError('not_found', 'Workspace not found', 404);
  return default_inbound_email_username(workspace.workspace_name);
}
