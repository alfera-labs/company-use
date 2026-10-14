import { build_system_prompt } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import {
  format_workspace_library_sync_message,
  get_workspace_library_context,
} from '@runtime-platform/orchestrator/context/workspace_library_context';
import { describe, expect, it } from 'vitest';

const what_to_remember_heading = '## What To Remember';
const no_run = {} as Parameters<typeof get_workspace_library_context>[0];

async function prompt_for_run_with_tools(allowed_tool_names?: readonly string[]) {
  const workspace_library = await get_workspace_library_context(no_run);
  return build_system_prompt({
    system_instructions: 'You are the agent.',
    ...(workspace_library ? { workspace_library } : {}),
    ...(allowed_tool_names ? { allowed_tool_names } : {}),
  });
}

describe('What To Remember section', () => {
  it('is in the prompt of a run that can write files', async () => {
    const prompt = await prompt_for_run_with_tools(['workspace-write_file', 'workspace-read_file']);

    expect(prompt).toContain(what_to_remember_heading);
    expect(prompt).toContain('its files are the memory');
    expect(prompt).toContain('A standing rule goes in a skill');
    expect(prompt).toContain('search the workspace files');
  });

  it('is in the prompt of a run with every tool', async () => {
    expect(await prompt_for_run_with_tools()).toContain(what_to_remember_heading);
  });

  it('is not in the prompt of a run that cannot write files', async () => {
    const prompt = await prompt_for_run_with_tools(['runtime-web_search-1']);

    expect(prompt).not.toContain(what_to_remember_heading);
  });

  it('names no company memory tool and no document library', async () => {
    const prompt = await prompt_for_run_with_tools();

    expect(prompt).not.toContain('## Workspace Library');
    expect(prompt).not.toContain('runtime-search_documents-1');
    expect(prompt).not.toContain('runtime-sync_into_memory-1');
    expect(format_workspace_library_sync_message()).toBeNull();
  });
});
