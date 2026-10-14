import { z } from 'zod';

/** https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations */
const fields_a_chatgpt_plan_refuses = new Set([
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'previous_response_id',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'service_tier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
]);

export const chatgpt_plan_tool_namespace = 'alfera';

const responses_payload_schema = z
  .object({
    input: z.array(z.unknown()).default([]),
    instructions: z.string().optional(),
    tools: z.array(z.unknown()).optional(),
  })
  .passthrough();

const system_item_schema = z
  .object({
    role: z.literal('system'),
    content: z.union([z.string(), z.array(z.object({ text: z.string() }).passthrough())]),
  })
  .passthrough();

const function_tool_schema = z.object({ type: z.literal('function') }).passthrough();

type SystemItem = z.infer<typeof system_item_schema>;

export function rewrite_payload_for_chatgpt_plan(payload: unknown): unknown {
  const parsed = responses_payload_schema.safeParse(payload);
  if (!parsed.success) return payload;

  const kept = Object.fromEntries(
    Object.entries(parsed.data).filter(([field]) => !fields_a_chatgpt_plan_refuses.has(field)),
  );
  const system_items = parsed.data.input.flatMap(read_system_item);
  const instructions = [parsed.data.instructions ?? '', ...system_items.map(read_item_text)]
    .filter(Boolean)
    .join('\n\n');

  return {
    ...kept,
    ...(instructions ? { instructions } : {}),
    ...(parsed.data.tools ? { tools: group_function_tools(parsed.data.tools) } : {}),
    input: parsed.data.input.filter((item) => read_system_item(item).length === 0),
    store: false,
    stream: true,
  };
}

function group_function_tools(tools: unknown[]) {
  const function_tools = tools.filter((tool) => function_tool_schema.safeParse(tool).success);
  if (function_tools.length === 0) return tools;

  const namespace = {
    type: 'namespace',
    name: chatgpt_plan_tool_namespace,
    description: 'The tools this agent can call.',
    tools: function_tools,
  };
  return [namespace, ...tools.filter((tool) => !function_tools.includes(tool))];
}

function read_system_item(item: unknown): SystemItem[] {
  const parsed = system_item_schema.safeParse(item);
  return parsed.success ? [parsed.data] : [];
}

function read_item_text(item: SystemItem): string {
  if (typeof item.content === 'string') return item.content;
  return item.content.map((part) => part.text).join('\n');
}
