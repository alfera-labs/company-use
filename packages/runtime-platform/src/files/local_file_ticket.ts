import { AppError } from '@coworker/shared';
import { bucket_env_names } from '@runtime-platform/files/file_storage_locations';
import { read_signed_claims, sign_claims } from '@runtime-platform/signed_claims';
import { z } from 'zod';

const ticket_purpose = 'local_file_ticket';

/** The dashboard forwards `/api/*` to the API, so this path is same-origin for every browser. */
export const local_file_objects_dashboard_path = '/api/v1/local_file_objects';

const shared_claims = {
  v: z.literal(1),
  bucket_folder: z.enum(bucket_env_names),
  object_key: z.string().min(1),
  content_type: z.string().min(1),
  exp: z.number().int().positive(),
};

const ticket_claims_schema = z.discriminatedUnion('operation', [
  z
    .object({
      ...shared_claims,
      operation: z.literal('put'),
      byte_size: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ ...shared_claims, operation: z.literal('get'), file_name: z.string().min(1) })
    .strict(),
]);

export type LocalFileTicketClaims = z.infer<typeof ticket_claims_schema>;
type Operation = LocalFileTicketClaims['operation'];
type DistributedOmit<Value, Key extends PropertyKey> = Value extends unknown
  ? Omit<Value, Key>
  : never;

export function create_local_file_url(
  input: DistributedOmit<LocalFileTicketClaims, 'v' | 'exp'> & { expires_in_seconds: number },
  now: Date = new Date(),
) {
  const { expires_in_seconds, ...claims } = input;
  const exp = Math.floor(now.getTime() / 1000) + expires_in_seconds;
  const ticket = sign_claims(ticket_purpose, { v: 1, ...claims, exp });
  return `${local_file_objects_dashboard_path}?ticket=${ticket}`;
}

export function verify_local_file_ticket<Wanted extends Operation>(
  ticket: string,
  operation: Wanted,
  now: Date = new Date(),
): Extract<LocalFileTicketClaims, { operation: Wanted }> {
  const parsed = ticket_claims_schema.safeParse(read_signed_claims(ticket_purpose, ticket));
  if (!parsed.success || parsed.data.operation !== operation) {
    throw local_file_ticket_refused('The file link is not valid.');
  }
  if (parsed.data.exp * 1000 <= now.getTime())
    throw local_file_ticket_refused('The file link expired.');
  return parsed.data as Extract<LocalFileTicketClaims, { operation: Wanted }>;
}

export function local_file_ticket_refused(message: string) {
  return new AppError('local_file_ticket_refused', message, 403);
}
