import {
  get_model,
  read_workspace_model_catalog_environment,
} from '@api/services/models/model_catalog';
import type { Database } from '@coworker/core';
import { list_files_by_ids } from '@coworker/core/db/queries/files';
import { get_agent } from '@coworker/core/db/queries/sessions';
import {
  message_file_part_schema,
  message_image_part_schema,
  message_text_part_schema,
  model_name_schema,
  model_provider_schema,
  model_proxy_schema,
  NotFoundError,
  ValidationError,
} from '@coworker/shared';
import { z } from 'zod';

const content_part_schema = z.discriminatedUnion('type', [
  message_text_part_schema
    .pick({ type: true, text: true })
    .extend({ text: z.string().min(1).max(50_000) })
    .strict(),
  message_image_part_schema
    .extend({ mime_type: z.string().min(1).max(120), source: z.string().max(500).optional() })
    .strict(),
  message_file_part_schema
    .extend({
      file_id: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
      name: z.string().min(1).max(240).optional(),
      mime_type: z.string().max(120).optional(),
      text: z.string().max(50_000).optional(),
    })
    .strict()
    .refine((part) => Boolean(part.file_id || part.path || part.url || part.text), {
      message: 'A file needs content or a file reference.',
    }),
]);

const job_input_schema = z
  .object({
    instruction: z.string().trim().min(1).max(50_000),
    context_digest: z.string().max(50_000).optional(),
    content: z.array(content_part_schema).max(20).optional(),
    model_provider: model_provider_schema.optional(),
    model_proxy: model_proxy_schema.optional(),
    model_name: model_name_schema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const field_count = [value.model_provider, value.model_proxy, value.model_name].filter(
      Boolean,
    ).length;
    if (field_count !== 0 && field_count !== 3) {
      ctx.addIssue({ code: 'custom', message: 'A model selection needs all model fields.' });
    }
  });

export async function validate_trigger_agent_and_job_input(input: {
  db: Database;
  workspace_id: string;
  agent_id?: string;
  trigger_config?: Record<string, unknown>;
}) {
  if (input.agent_id && !(await get_agent(input.db, input.workspace_id, input.agent_id))) {
    throw new NotFoundError('Agent');
  }
  if (input.trigger_config?.starts_job_handler !== 'run_scheduled_agent_task') return;

  const parsed = job_input_schema.safeParse(input.trigger_config.job_input);
  if (!parsed.success) {
    throw new ValidationError(
      'The scheduled task input failed validation',
      z.flattenError(parsed.error),
    );
  }

  await Promise.all([
    validate_model(input.db, input.workspace_id, parsed.data),
    validate_files(input.db, input.workspace_id, parsed.data.content ?? []),
  ]);
}

async function validate_model(
  db: Database,
  workspace_id: string,
  job_input: z.infer<typeof job_input_schema>,
) {
  if (!job_input.model_provider || !job_input.model_proxy || !job_input.model_name) return;
  const model = await get_model({
    model_proxy: job_input.model_proxy,
    model_id: job_input.model_name,
    model_environment: await read_workspace_model_catalog_environment(db, workspace_id),
  });
  if (model.model_provider !== job_input.model_provider) {
    throw new ValidationError(
      `Model ${model.model_id} is provided by ${model.model_provider}, not ${job_input.model_provider}`,
    );
  }
}

async function validate_files(
  db: Database,
  workspace_id: string,
  content: z.infer<typeof content_part_schema>[],
) {
  const file_ids = content.flatMap((part) =>
    part.type === 'file' && part.file_id ? [part.file_id] : [],
  );
  const files = await list_files_by_ids(db, workspace_id, file_ids);
  if (new Set(files.map((file) => file.file_id)).size !== new Set(file_ids).size) {
    throw new ValidationError('A scheduled task file does not belong to this workspace.');
  }
}
