import { z } from 'zod';

export const server_address_pattern =
  /^https:\/\/(?:[a-z0-9]{1,20}-)?(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:-(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\.sslip\.io$/;

export const install_id_schema = z.uuid();
export const token_schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const id_word_schema = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);

export const progress_report_schema = z.strictObject({
  install_id: install_id_schema,
  step: id_word_schema,
  state: z.enum(['started', 'done', 'failed']),
  reason: id_word_schema.nullable(),
  address: z.string().regex(server_address_pattern).nullable(),
  at: z.iso.datetime({ offset: true }),
});
export type ProgressReport = z.infer<typeof progress_report_schema>;

export const status_answer_schema = z.object({
  data: z.object({ reports: z.array(progress_report_schema), site_time: z.number() }),
});

export const access_token_answer_schema = z.object({
  data: z.object({ access_token: z.string().min(8) }),
});
