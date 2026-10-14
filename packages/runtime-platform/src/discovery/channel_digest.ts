import { create_llm_gateway } from '@agent-core/llm_gateway';
import { redact_credentials_in_text } from '@coworker/shared';
import { z } from 'zod';

const digest_instructions = `You summarize recent Slack channel activity for an AI coworker.
Return 3-5 short bullet points capturing only durable, useful information: decisions made, projects and their status, blockers, responsibilities, plans, and recurring themes.
Each line starts with the day it was posted. When somebody does the same job by hand again and again (a report, a list, numbers copied between tools, a file uploaded every week), give it its own bullet and keep who does it, how often and on which day, and every tool, file name and link it touches, word for word.
Never copy a password, a login, an API key or a token, even when a message contains one: write "a login was shared here" and nothing more.
Skip greetings, chit-chat, one-off logistics, and anything with no value in a week.
If the messages contain nothing durable, return an empty list.
Answer with JSON: {"summary_points": ["...", "..."]}.`;

const digest_schema = z.object({
  summary_points: z.array(z.string()).default([]),
});

export type ChannelActivitySummarizer = {
  summarize(input: {
    channel_label: string;
    message_lines: string[];
    workspace_id: string;
  }): Promise<string | null>;
};

export function make_channel_activity_summarizer(): ChannelActivitySummarizer {
  return {
    summarize: async ({ channel_label, message_lines, workspace_id }) => {
      if (message_lines.length === 0) return null;
      const result = await create_llm_gateway().generate_object({
        use_case: 'slack_discovery',
        workspace_id,
        system_prompt: digest_instructions,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Channel: ${channel_label}\n\n${message_lines.join('\n')}`,
              },
            ],
          },
        ],
        response_format: { type: 'json_object', schema_name: 'slack_channel_digest' },
        parse: (value) => digest_schema.parse(value),
      });
      const points = result.object.summary_points
        .filter((point) => typeof point === 'string' && point.trim() !== '')
        .map((point) => redact_credentials_in_text(point.trim()));
      return points.length > 0 ? points.join('\n') : null;
    },
  };
}
