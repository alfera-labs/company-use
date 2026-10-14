import { z } from 'zod';

const optional_line = (max_length: number) =>
  z
    .string()
    .trim()
    .max(max_length)
    .transform((value) => value || undefined)
    .optional();

const trimmed_lines = (max_items: number, max_length: number) =>
  z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => typeof item !== 'string' || item.trim()).slice(0, max_items)
        : value,
    z.array(z.string().trim().min(1).max(max_length)),
  );

const onboarding_company_scan_finding_schema = z.object({
  name: optional_line(60),
  offer: optional_line(160),
  steps: trimmed_lines(4, 140).optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(600),
  prompt: z.string().trim().min(1).max(800),
  evidence: optional_line(400),
  source_url: optional_line(400),
  tools: z
    .array(z.object({ name: z.string().min(1).max(60), logo_url: z.string().min(1).max(300) }))
    .max(4)
    .optional(),
});

const onboarding_company_scan_source_schema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(400),
});

/**
 * What we worked out about the company before onboarding asked them anything: a short brief plus
 * the findings the app turns into first prompts. The scan comes from model output. A model asked
 * to leave a field out answers "" about as often as it obeys, and a model asked for at most three
 * findings sometimes sends four, so the helpers above turn both into the shape we asked for.
 */
export const onboarding_company_scan_schema = z.object({
  company_name: z.string().trim().max(160),
  company_kind: z.string().trim().max(160).optional(),
  summary: z.string().trim().max(800),
  scan_facts: trimmed_lines(5, 200),
  findings: z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, 3) : value),
    z.array(onboarding_company_scan_finding_schema),
  ),
  sources: z.array(onboarding_company_scan_source_schema).max(12).optional(),
  gaps: trimmed_lines(3, 200).optional(),
  business_type: z
    .enum(['software', 'local_service', 'ecommerce', 'agency', 'media', 'other'])
    .optional(),
  scanned_url: z.string().nullable(),
  scanned_at: z.string(),
});

export type OnboardingCompanyScan = z.infer<typeof onboarding_company_scan_schema>;
