import type { SkillDefinition } from '@runtime-platform/skills/types';

export const research_briefing_skill: SkillDefinition = {
  skill_slug: 'research-briefing',
  skill_name: 'Research briefing',
  description:
    'Use when the user asks for research, a briefing, a summary of findings, or a "what do we know about X" deliverable that pulls from web search or connected sources.',
  body: [
    '# Research briefing',
    '',
    'Produce a decision-ready briefing, not a link dump.',
    '',
    '## Steps',
    '1. Restate the question in one line so the user can correct scope before you spend effort.',
    '2. Gather sources with the available search and read tools. Prefer primary sources and cross-check any claim that drives a decision.',
    '3. Note the date of each key fact and flag anything that may be stale.',
    '',
    '## Deliverable shape',
    '- **Answer first**: two or three sentences that directly answer the question.',
    '- **Key findings**: three to six bullets, each with its source in parentheses.',
    '- **Open questions**: what you could not confirm, and why.',
    '',
    'Keep it tight. If a claim is uncertain, say so plainly rather than hedging every sentence.',
  ].join('\n'),
};
