import { z } from 'zod';

export const list_trigger_types_input_schema = z.strictObject({
  app_name: z
    .string()
    .min(1)
    .optional()
    .describe('Only list trigger types for one app, for example composio_gmail or outlook.'),
});

const trigger_setup_field_schema = z.strictObject({
  name: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
  type: z.string().nullable(),
  enum: z.array(z.unknown()).optional(),
  has_default: z.boolean(),
  chip_word: z.string().nullable(),
  empty_means: z.string().nullable(),
  unit: z.string().nullable(),
  hidden_at_default: z.boolean(),
  choices_from_provider: z.boolean(),
  minimum: z.number().nullable(),
});

export const trigger_type_schema = z.strictObject({
  node_key: z.string(),
  display_name: z.string(),
  display_name_without_app: z.string(),
  app_name: z.string(),
  description: z.string().nullable(),
  setup_fields: z.array(trigger_setup_field_schema),
  event_fields: z.array(z.strictObject({ name: z.string(), label: z.string() })),
});

export const trigger_type_output_schema = z.strictObject({
  count: z.number(),
  trigger_types: z.array(
    trigger_type_schema.extend({
      connected: z.boolean(),
      connection_id: z.string().nullable(),
      connections: z.array(
        z.strictObject({
          connection_id: z.string(),
          connection_name: z.string(),
          account_label: z.string().nullable(),
        }),
      ),
    }),
  ),
});
