import { AppError } from '@coworker/shared';
import { read_signed_claims, sign_claims } from '@runtime-platform/signed_claims';
import { z } from 'zod';

const ticket_purpose = 'run_stream_ticket';
export const run_stream_ticket_lifetime_ms = 5 * 60_000;

const ticket_claims_schema = z
  .object({
    v: z.literal(2),
    key_scope: z.string().min(1),
    workspace_id: z.string().min(1),
    session_id: z.string().min(1),
    user_id: z.string().min(1),
    exp: z.number().int().positive(),
  })
  .strict();

export type RunStreamTicketClaims = z.infer<typeof ticket_claims_schema>;
type TicketScope = { key_scope: string; workspace_id: string; session_id: string };

export function issue_run_stream_ticket(
  input: TicketScope & { user_id: string },
  now: Date = new Date(),
) {
  const expires_ms = now.getTime() + run_stream_ticket_lifetime_ms;
  const claims: RunStreamTicketClaims = { v: 2, ...input, exp: Math.floor(expires_ms / 1000) };
  return {
    ticket: sign_claims(ticket_purpose, claims),
    expires_time: new Date(claims.exp * 1000).toISOString(),
  };
}

export function verify_run_stream_ticket(
  ticket: string,
  expected: TicketScope,
  now: Date = new Date(),
): RunStreamTicketClaims {
  const parsed = ticket_claims_schema.safeParse(read_signed_claims(ticket_purpose, ticket));
  if (!parsed.success) throw ticket_refused('The live stream ticket is not valid.');
  const claims = parsed.data;
  if (claims.exp * 1000 <= now.getTime()) throw ticket_refused('The live stream ticket expired.');
  const same_chat =
    claims.key_scope === expected.key_scope &&
    claims.workspace_id === expected.workspace_id &&
    claims.session_id === expected.session_id;
  if (!same_chat) {
    throw ticket_refused('The live stream ticket is for another chat.');
  }
  return claims;
}

function ticket_refused(message: string) {
  return new AppError('run_stream_ticket_refused', message, 401);
}
