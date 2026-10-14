import { type BrainTool, define_brain_tool } from '@api/routes/brain/brain_tool';
import { reads_the_workspace } from '@api/routes/brain/mcp_tool_annotations';
import { skills_query_schema } from '@api/routes/public_skills';
import { list_api_integrations } from '@api/services/integrations_api/integration_reads';
import { list_api_skills } from '@api/services/skills_api/skill_reads';
import { z } from 'zod';

export const workspace_mcp_tools: Record<string, BrainTool> = {
  list_integrations: define_brain_tool({
    title: 'List integrations',
    annotations: reads_the_workspace,
    description:
      'List the apps this company connected to Alfera (CRM, inbox, store, calendar and so on), each with its name, kind, and how many actions it offers. Answers at once: use it instead of a session whenever the person asks what is connected or what Alfera can reach. No credentials leave.',
    required_scope: 'integrations.read',
    input_schema: z.strictObject({}),
    run: async (db, api_key) =>
      (await list_api_integrations(db, api_key)).map((integration) => ({
        name: integration.name,
        kind: integration.kind,
        tool_count: integration.tool_count,
      })),
  }),

  list_skills: define_brain_tool({
    title: 'List skills',
    annotations: reads_the_workspace,
    description:
      'List the skills an agent can load: the platform library and the procedures the agent wrote for itself. Name the agent by slug; `main` is the default.',
    required_scope: 'skills.read',
    input_schema: skills_query_schema,
    run: (db, api_key, args) => list_api_skills(db, api_key, args.agent),
  }),
};
