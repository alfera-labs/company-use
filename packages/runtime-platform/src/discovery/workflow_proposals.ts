import { create_llm_gateway } from '@agent-core/llm_gateway';
import { product_brand_config } from '@coworker/config';
import { build_coworker_voice_guide } from '@coworker/shared';
import { z } from 'zod';

const max_proposals_per_run = 3;

const example_proposal = JSON.stringify({
  title: 'The Monday sales report',
  owner_first_name: 'Alex',
  steps: [
    'pull the deals from HubSpot and the payouts from Stripe',
    'add them to the Google Sheet',
    'post the summary in #sales',
  ],
  offer: 'I can do all of that, every Monday at 9.',
  short_offer: 'build the Monday sales report from HubSpot and Stripe',
  tool_names: ['HubSpot', 'Stripe', 'Google Sheets'],
});

function build_proposal_instructions(coworker_name: string) {
  return [
    build_coworker_voice_guide(coworker_name),
    "You just joined this company's Slack and read back through the channels. Now you tell the team which recurring jobs you would take off them.",
    'You are given a summary of each channel: what the team does, who does what, and what keeps coming back.',
    'Find the work somebody clearly does BY HAND again and again, which you could run on a schedule instead: a weekly report, a list someone compiles, numbers someone copies between tools, follow-ups someone chases.',
    [
      'Rules:',
      '- Only propose what the summaries support. Never invent activity, people or tools.',
      '- Each proposal is one concrete, repeatable job. Never a vague offer to "help with sales".',
      '- Best first: the job that costs a named person the most time comes first.',
      '- Take their side. Never propose watching, flagging, auditing or reminding people about their own behaviour. Offer to do the chore for them instead: "log your calls in HubSpot so nobody has to remember", never "flag reps who do not log calls".',
      '- Do not repeat anything in the already-proposed list.',
      `- At most ${max_proposals_per_run} proposals. Offer every recurring chore the summaries really show, the small ones too, because the team should see how much you can take. Zero is the right answer when they show none.`,
      '- Write in English.',
    ].join('\n'),
    [
      'For each proposal write:',
      '- title: the job as a noun, at most 5 words: "The Monday sales report".',
      '- owner_first_name: first name of the one person who visibly does this job today, or null when it is not one clear person.',
      '- steps: 2 to 4 steps of how the job is done TODAY, as you understood it. At most 10 words each, starting with a lowercase verb, naming the real tools. No full stop.',
      '- offer: one short sentence saying you can do all of it, with the day and time when the summaries show one.',
      '- short_offer: the whole job in one line, at most 12 words, starting with a lowercase verb, with one real detail from the summaries.',
      '- tool_names: the tools you would need connected, as plain product names. Never Slack. Empty when none.',
    ].join('\n'),
    `Answer with JSON: {"proposals": [${example_proposal}]}.`,
  ].join('\n\n');
}

export type WorkflowProposal = {
  title: string;
  owner_first_name: string | null;
  steps: string[];
  offer: string;
  short_offer: string;
  tool_names: string[];
};

const proposal_schema = z.object({
  proposals: z
    .array(
      z
        .object({
          title: z.string().trim().min(1),
          owner_first_name: z.string().trim().min(1).nullable().catch(null),
          steps: z.array(z.string().trim().min(1)).min(2).max(4),
          offer: z.string().trim().min(1),
          short_offer: z.string().trim().min(1),
          tool_names: z.array(z.string().trim().min(1)).catch([]),
        })
        .nullable()
        .catch(null),
    )
    .default([]),
});

export type WorkflowProposalWriter = {
  write(input: {
    workspace_id: string;
    workspace_name: string;
    source_lines: string[];
    already_proposed_titles: string[];
    connected_tool_names: string[];
  }): Promise<WorkflowProposal[]>;
};

export function make_workflow_proposal_writer(): WorkflowProposalWriter {
  return {
    write: async ({
      workspace_id,
      workspace_name,
      source_lines,
      already_proposed_titles,
      connected_tool_names,
    }) => {
      if (source_lines.length === 0) return [];
      const already =
        already_proposed_titles.length > 0
          ? `\n\nAlready proposed (do not repeat):\n${already_proposed_titles.join('\n')}`
          : '';
      const connected =
        connected_tool_names.length > 0
          ? `\n\nTools already connected for this workspace (jobs using these can start at once, prefer them when the evidence supports several options):\n${connected_tool_names.join(', ')}`
          : '';
      const result = await create_llm_gateway().generate_object({
        use_case: 'slack_workflow_proposal',
        workspace_id,
        system_prompt: build_proposal_instructions(product_brand_config.product_brand_name),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Workspace: ${workspace_name}\n\nWhat the channels have been about:\n${source_lines.join('\n')}${connected}${already}`,
              },
            ],
          },
        ],
        response_format: { type: 'json_object', schema_name: 'slack_workflow_proposals' },
        parse: (value) => proposal_schema.parse(value),
      });
      return result.object.proposals
        .filter((proposal): proposal is WorkflowProposal => proposal !== null)
        .slice(0, max_proposals_per_run);
    },
  };
}
