import { z } from 'zod';

const reserved_project_names = new Set(['personal', 'workspace']);

const project_name_schema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((name) => !reserved_project_names.has(name.toLowerCase()), {
    message: 'Personal and Workspace are reserved project names.',
  });

export const create_project_schema = z.object({ project_name: project_name_schema }).strict();

export const update_project_schema = z
  .object({
    project_name: project_name_schema.optional(),
    project_status: z.enum(['active', 'archived']).optional(),
    project_description: z.string().trim().max(1_000).nullable().optional(),
    project_instructions: z.string().trim().max(12_000).nullable().optional(),
  })
  .strict();

export const list_projects_schema = z
  .object({
    project_status: z.enum(['active', 'archived']).default('active'),
    query: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const project_member_schema = z
  .object({
    grantee_type: z.enum(['user', 'agent']),
    grantee_id: z.string().min(1),
    grant_level: z.enum(['use', 'manage']).default('use'),
  })
  .strict();

export const project_member_grantee_schema = z.enum(['user', 'agent']);
