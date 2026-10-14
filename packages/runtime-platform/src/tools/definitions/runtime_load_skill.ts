import { agent_browser_binary } from '@agent-core/browser/agent_browser_command';
import type { SessionEnv } from '@agent-core/environment';
import { format_skill_invocation } from '@agent-core/harness/resources';
import { load_workspace_procedure } from '@runtime-platform/skills/load_workspace_procedure';
import { to_harness_skill } from '@runtime-platform/skills/map_skill_to_harness_skill';
import { find_skill_by_slug } from '@runtime-platform/skills/skill_registry';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const operate_the_browser_skill_slug = 'operate-the-browser';

function warm_browser_in_background(environment: SessionEnv | undefined) {
  if (!environment?.exec) return;
  void environment
    .exec({ command: agent_browser_binary, args: ['get', 'url'], timeout_ms: 30_000 })
    .catch(() => {});
}

const input_schema = z.object({
  skill_slug: z.string().min(1).max(64),
});

export const runtime_load_skill_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-load_skill-1',
  node_name: 'load_skill',
  display_name: 'Load skill',
  description:
    'Loads the full instructions for a skill listed in <available_skills>. Call it with the ' +
    'skill name when a task matches the skill hint. The hint is a shortened summary, so load ' +
    'the skill whenever a task is plausibly in its scope.',
  category: 'context',
  input_schema: {
    type: 'object',
    properties: {
      skill_slug: {
        type: 'string',
        description: 'The skill name shown in <available_skills>, for example research-briefing.',
      },
    },
    required: ['skill_slug'],
  },
  output_schema: {
    type: 'object',
    properties: {
      skill_slug: { type: 'string' },
      skill_name: { type: 'string' },
      content: { type: 'string' },
      preloaded_tools: { type: 'array', items: { type: 'object' } },
      resources: { type: 'array', items: { type: 'string' } },
    },
    required: ['skill_slug', 'skill_name', 'content'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.load_skill',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, policy_exempt: true },
  validate_input: input_schema,
  async execute(input, context) {
    const skill = find_skill_by_slug(input.skill_slug);
    const procedure =
      context && !skill ? await load_workspace_procedure(input.skill_slug, context) : undefined;
    if (procedure) {
      return {
        success: true,
        data: {
          skill_slug: procedure.skill_slug,
          skill_name: procedure.skill_name,
          content: procedure.content,
          preloaded_tools: procedure.preloaded_tools,
          resources: procedure.resources.map(
            (resource) => `skills/${procedure.skill_slug}/${resource}`,
          ),
        },
        metadata: { source: 'workspace_procedure', preloaded: procedure.preloaded_tools.length },
      };
    }

    if (!skill || skill.disable_model_invocation) {
      return {
        success: false,
        error: {
          code: 'skill_not_found',
          message: `No loadable skill was found for ${input.skill_slug}.`,
        },
      };
    }

    if (skill.skill_slug === operate_the_browser_skill_slug) {
      warm_browser_in_background(context?.environment);
    }

    return {
      success: true,
      data: {
        skill_slug: skill.skill_slug,
        skill_name: skill.skill_name,
        content: format_skill_invocation(to_harness_skill(skill)),
        preloaded_tools: [],
        resources: [],
      },
      metadata: { source: 'skill_registry' },
    };
  },
};
