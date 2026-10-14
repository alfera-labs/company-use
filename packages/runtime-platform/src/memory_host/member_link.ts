import type { Database } from '@coworker/core';
import {
  confirm_source_actor_member_link,
  get_source_actor,
  request_source_actor_member_link,
} from '@coworker/core/db/queries/source_actors';
import { find_user_by_email } from '@coworker/core/db/queries/users';
import { resolve_chat_speaker } from '@runtime-platform/orchestrator/chat_speaker';
import type { RuntimeToolSourceMetadata } from '@runtime-platform/tools/types';

export type MemberLinkRequestOutcome =
  | { outcome: 'requested'; candidate_user_id: string }
  | { outcome: 'already_pending'; candidate_user_id: string | null }
  | { outcome: 'already_linked'; linked_user_id: string | null }
  | { outcome: 'source_actor_not_found' };

export type MemberLinkRequestInput = {
  workspace_id: string;
  source_actor_id: string;
  candidate_user_id: string;
  actor_id: string;
};

/**
 * Ask to link a source actor (a Slack or email identity) to a workspace member account.
 * Writes `member_link_state='pending_confirmation'` once; a second call on an already-pending or
 * already-linked row answers from the stored state and writes nothing.
 */
export async function request_member_account_link(
  db: Database,
  input: MemberLinkRequestInput,
): Promise<MemberLinkRequestOutcome> {
  const current = await get_source_actor(db, input);
  if (!current) return { outcome: 'source_actor_not_found' };
  if (current.member_link_state !== 'unlinked') {
    return outcome_for_existing_state(current);
  }

  const written = await request_source_actor_member_link(db, input);
  if (!written) {
    const refreshed = await get_source_actor(db, input);
    return refreshed
      ? outcome_for_existing_state(refreshed)
      : { outcome: 'source_actor_not_found' };
  }
  return {
    outcome: 'requested',
    candidate_user_id: written.linked_user_id ?? input.candidate_user_id,
  };
}

function outcome_for_existing_state(
  source_actor: NonNullable<Awaited<ReturnType<typeof get_source_actor>>>,
): MemberLinkRequestOutcome {
  return source_actor.member_link_state === 'linked'
    ? { outcome: 'already_linked', linked_user_id: source_actor.linked_user_id }
    : { outcome: 'already_pending', candidate_user_id: source_actor.linked_user_id };
}

export type MemberLinkConfirmOutcome =
  | { outcome: 'confirmed'; linked_user_id: string }
  | { outcome: 'nothing_was_pending' }
  | { outcome: 'source_actor_not_found' };

export async function confirm_member_account_link(
  db: Database,
  input: { workspace_id: string; source_actor_id: string; actor_id: string },
): Promise<MemberLinkConfirmOutcome> {
  const current = await get_source_actor(db, input);
  if (!current) return { outcome: 'source_actor_not_found' };
  if (current.member_link_state !== 'pending_confirmation' || !current.linked_user_id) {
    return { outcome: 'nothing_was_pending' };
  }
  const confirmed = await confirm_source_actor_member_link(db, input);
  return confirmed?.linked_user_id
    ? { outcome: 'confirmed', linked_user_id: confirmed.linked_user_id }
    : { outcome: 'nothing_was_pending' };
}

export type MemberLinkProposalState =
  | Exclude<MemberLinkRequestOutcome['outcome'], 'source_actor_not_found'>
  | 'no_such_member'
  | 'speaker_unresolved';

export type MemberLinkProposalInput = {
  workspace_id: string;
  actor_id: string;
  workspace_email: string;
  source_metadata?: RuntimeToolSourceMetadata | undefined;
};

/**
 * Propose a link from the chat identity that is speaking now to the member with this email.
 * The link stays pending until a workspace admin confirms it.
 */
export async function propose_member_account_link_by_email(
  db: Database,
  input: MemberLinkProposalInput,
): Promise<MemberLinkProposalState> {
  const workspace_member = await find_user_by_email(db, input.workspace_email);
  if (!workspace_member) return 'no_such_member';
  const speaker = await resolve_chat_speaker(db, input);
  if (!speaker) return 'speaker_unresolved';
  const requested = await request_member_account_link(db, {
    workspace_id: input.workspace_id,
    source_actor_id: speaker.source_actor_id,
    candidate_user_id: workspace_member.user_id,
    actor_id: input.actor_id,
  });
  return requested.outcome === 'source_actor_not_found' ? 'speaker_unresolved' : requested.outcome;
}
