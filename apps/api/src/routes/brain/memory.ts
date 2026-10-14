import type { ApiEnv } from '@api/lib/context';
import { Hono } from 'hono';
import { z } from 'zod';

const search_result_limit = 10;

export const search_body_schema = z
  .object({
    query: z.string().min(1).max(2000),
    limit: z.number().int().min(1).max(100).default(search_result_limit),
    end_user: z.unknown().optional(),
  })
  .strict();

export const context_body_schema = search_body_schema.extend({
  token_budget: z.number().int().positive().optional(),
});

export const read_document_body_schema = z.object({ slug: z.string().min(1).max(200) }).strict();

export const brain_memory_routes = new Hono<ApiEnv>();
