import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { describe, expect, it } from 'vitest';

const skills_discovery = '<available_skills>\n- operate-the-browser\n</available_skills>';

function answer_prompt(allowed_tool_names: readonly string[]) {
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    model: { model_provider: 'anthropic', model_name: 'claude-sonnet-5' },
    skills_discovery,
    allowed_tool_names,
  });
}

function block_of(prompt: string, heading: string) {
  const start = prompt.indexOf(heading);
  if (start === -1) return '';
  const end = prompt.indexOf('\n\n##', start + 1);
  return end === -1 ? prompt.slice(start) : prompt.slice(start, end);
}

describe('the Recurring Work Protocol on a run that can create automations', () => {
  it('sends new recurring work to create_automation with a schedule trigger', () => {
    const prompt = answer_prompt(['automations-create_automation-1']);

    expect(prompt).toContain('## Recurring Work Protocol');
    expect(prompt).toContain('using automations-create_automation-1 with a schedule trigger');
    expect(prompt).toContain('scheduled_tasks-create_scheduled_task-1 is only for a one-time run');
  });

  it('offers to widen a recurring task and changes it only on a yes', () => {
    const block = block_of(
      answer_prompt(['automations-create_automation-1']),
      '## Recurring Work Protocol',
    );

    expect(block).toContain('would have caught had it covered a little more');
    expect(block).toContain('say so and offer once to widen it');
    expect(block).toContain('Change it only on their yes');
    expect(answer_prompt([])).not.toContain('offer once to widen it');
  });
});
