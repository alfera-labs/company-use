import { z } from 'zod';

export const server_address_pattern =
  /^https:\/\/(?:[a-z0-9]{1,20}-)?(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:-(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\.sslip\.io$/;

export const install_id_schema = z.uuid();
export const report_token_schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const step_id_schema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
const oauth_value_schema = z.string().regex(/^[A-Za-z0-9._~-]{8,512}$/);

export const deploy_clouds = ['digitalocean', 'aws'] as const;

export const new_deploy_session_schema = z.strictObject({
  install_id: install_id_schema,
  report_token_hash: z.string().regex(/^[0-9a-f]{64}$/),
  cloud: z.enum(deploy_clouds),
});

export const progress_report_schema = z.strictObject({
  install_id: install_id_schema,
  step: step_id_schema,
  state: z.enum(['started', 'done', 'failed']),
  reason: step_id_schema.nullable(),
  address: z.string().regex(server_address_pattern).nullable(),
  at: z.iso.datetime({ offset: true }),
});
export type ProgressReport = z.infer<typeof progress_report_schema>;

export const deploy_status_query_schema = z.strictObject({ install_id: install_id_schema });

export const digitalocean_code_schema = z.strictObject({
  client_id: oauth_value_schema.optional(),
  code: oauth_value_schema,
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  redirect_uri: z.url(),
});

export const digitalocean_token_schema = z.strictObject({ token: oauth_value_schema });

export const digitalocean_access_token_schema = z
  .record(z.string(), z.unknown())
  .transform((answer) => answer.access_token)
  .pipe(z.string().min(8));
