import { estimate_context_tokens_roughly } from '@coworker/shared';
import {
  build_not_set_up_protocol,
  list_services_not_set_up,
} from '@runtime-platform/orchestrator/context/not_set_up_protocol';
import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { get_workspace_library_context } from '@runtime-platform/orchestrator/context/workspace_library_context';
import { describe, expect, it } from 'vitest';

const heading = '## Not Set Up On This Install';
const sign_up_link = 'https://app.alfera.ai/sign-up?from=self-host';
const guide_link =
  'https://github.com/alfera-labs/company-use/blob/main/SELF_HOSTING.md#connect-your-apps';
const web_search = { name: 'web search', add_command: './alfera add search' };
const slack = { name: 'Slack', add_command: './alfera add slack' };

function prompt_of_an_install_without(services_not_set_up: (typeof web_search)[]) {
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    workspace_root: '/workspace',
    workspace_library: { document_count: 0, services_not_set_up },
  });
}

function block_of(prompt: string, block_heading: string) {
  const start = prompt.indexOf(block_heading);
  const end = prompt.indexOf('\n\n##', start + 1);
  return start === -1 ? '' : prompt.slice(start, end === -1 ? undefined : end);
}

describe('what the prompt says about a service this install has not set up', () => {
  it('names each missing service with its command, and both ways to get it', () => {
    const block = block_of(prompt_of_an_install_without([web_search, slack]), heading);

    expect(block).toContain(
      'It has not set up: web search (./alfera add search), Slack (./alfera add slack).',
    );
    expect(block).toContain('Answer in one plain sentence');
    expect(block).toContain(`their own key (that command, guide: ${guide_link})`);
    expect(block).toContain(`Alfera Cloud (${sign_up_link})`);
    expect(block).toContain('Say it once');
  });

  it('tells the model not to try the missing service and not to send a connect link', () => {
    const block = block_of(prompt_of_an_install_without([web_search]), heading);

    expect(block).toContain('do not try it and send no connect link');
    expect(block).not.toContain('Slack');
    expect(block).not.toContain('email');
  });

  it('says nothing when the install has set up every service', () => {
    expect(build_not_set_up_protocol([])).toBeNull();
    expect(prompt_of_an_install_without([])).not.toContain(heading);
  });

  it('is in the prompt of a run on this install, for each service its settings leave out', async () => {
    const library = await get_workspace_library_context(
      {} as Parameters<typeof get_workspace_library_context>[0],
    );
    const expected = build_not_set_up_protocol(list_services_not_set_up());
    const prompt = build_system_prompt({
      system_instructions: 'You are the agent.',
      ...(library ? { workspace_library: library } : {}),
    });

    expect(block_of(prompt, heading)).toBe(expected ?? '');
  });

  it('is its own block, so the Workspace Protocol stays inside its token budget', () => {
    const prompt = prompt_of_an_install_without(list_all_five_services());
    const workspace_protocol = block_of(prompt, '## Workspace Protocol');

    expect(workspace_protocol).not.toContain('self-hosted install');
    expect(estimate_context_tokens_roughly(workspace_protocol)).toBeLessThanOrEqual(700);
    expect(estimate_context_tokens_roughly(block_of(prompt, heading))).toBeLessThanOrEqual(190);
  });
});

function list_all_five_services() {
  return [
    { name: 'apps from the app catalogue', add_command: './alfera add apps' },
    { name: 'automations that start on an app event', add_command: './alfera add triggers' },
    slack,
    { name: 'email', add_command: './alfera add email' },
    web_search,
  ];
}
