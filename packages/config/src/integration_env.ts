import { boolean_env_schema } from '@coworker/config/env_value_schemas';
import { z } from 'zod';

export const integration_env_schema = {
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  JINA_API_KEY: z.string().optional(),
  JINA_READER_WITHOUT_A_KEY: boolean_env_schema.default(false),
  GITHUB_TOKEN: z.string().optional(),
  COMPOSIO_API_KEY: z.string().optional(),
  COMPOSIO_WEBHOOK_SECRET: z.string().optional(),
  MCP_OAUTH_ISSUER: z.string().url().optional(),
};
