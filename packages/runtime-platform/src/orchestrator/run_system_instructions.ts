import { remove_imported_persona_section } from '@coworker/core/db/queries/agent_persona';
import { with_agent_display_name } from '@runtime-platform/orchestrator/agent_display_name';

type InstructionsAgent =
  | {
      system_prompt?: string | null;
      agent_name?: string | null;
    }
  | undefined;

export function build_run_system_instructions(input: {
  agent: InstructionsAgent;
  include_imported_persona: boolean;
  durable_storage_unavailable: boolean | undefined;
  billing_context_line: string | null;
  memory_prompt_text?: string | null;
}) {
  return with_memory_prompt_block(
    with_billing_context_line(
      with_storage_notice(
        get_system_instructions(input.agent, input.include_imported_persona),
        input.durable_storage_unavailable,
      ),
      input.billing_context_line,
    ),
    input.memory_prompt_text ?? null,
  );
}

function with_memory_prompt_block(system_instructions: string, memory_prompt_text: string | null) {
  if (!memory_prompt_text) return system_instructions;
  return `${system_instructions}\n\n${memory_prompt_text}`;
}

function get_system_instructions(agent: InstructionsAgent, include_imported_persona: boolean) {
  const configured =
    agent?.system_prompt?.trim() || 'Business-facing worker. Keep internals hidden.';
  const instructions = include_imported_persona
    ? configured
    : remove_imported_persona_section(configured);
  return with_agent_display_name(instructions, agent?.agent_name);
}

function with_storage_notice(
  system_instructions: string,
  durable_storage_unavailable?: boolean,
): string {
  if (!durable_storage_unavailable) return system_instructions;
  return `${system_instructions}\n\n# Durable storage notice\nDurable workspace storage is temporarily unavailable for this run. Files from previous runs are NOT visible to you, and nothing you write to the filesystem will survive after this run. If the current task depends on existing files or produces files worth keeping, tell the user plainly that storage is temporarily down and suggest retrying once it is back.`;
}

function with_billing_context_line(
  system_instructions: string,
  billing_context_line: string | null,
) {
  if (!billing_context_line) return system_instructions;
  return `${system_instructions}\n\n${billing_context_line}`;
}
