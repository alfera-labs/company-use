import {
  bundle_manifest_schema,
  starts_when_schema,
} from '@coworker/core/templates/template_object';
import { z } from 'zod';

const it_will_be_able_to_schema = z.array(
  z.strictObject({
    capability: z.string(),
    risk: z.enum(['reads_data', 'changes_data', 'reaches_outside']),
  }),
);

const base_payload_shape = {
  folder_name: z.string().min(1),
  instruction_markdown: z.string(),
  description_text: z.string(),
  starts_when: starts_when_schema.default([]),
  discovery_phrases: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  available_on_source_types: z.array(z.string()).default([]),
  what_it_does: z.array(z.string()).default([]),
  what_you_get: z.array(z.string()).default([]),
  guidance: z.array(z.strictObject({ label: z.string(), value: z.string() })).default([]),
  used_when_text: z.string().nullable().default(null),
  outcome_text: z.string().default(''),
  it_will_be_able_to: it_will_be_able_to_schema.default([]),
  caveat_text: z.string().nullable().default(null),
  bundle_manifest: bundle_manifest_schema,
};

const nested_payload_schema = z.object(base_payload_shape);

const template_payload_schema = z.object({
  ...base_payload_shape,
  bundled_skills: z.array(nested_payload_schema).default([]),
});

export type ParsedTemplatePayload = z.infer<typeof template_payload_schema>;

export function read_template_payload(payload: unknown): ParsedTemplatePayload {
  return template_payload_schema.parse(payload);
}
