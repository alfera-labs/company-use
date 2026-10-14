/**
 * One block of the compiled system prompt.
 *
 * `steers_tools` names the tools the block exists for: it survives assembly only when the run holds
 * at least one of them. A block without `steers_tools` is universal — identity, safety, memory
 * framing, voice, output style — and is always emitted.
 *
 * `needs_any_tool` is for a block that steers HOW tools are called rather than which one to reach
 * for. Naming tools would be wrong: the rule holds for whatever tools the run happens to have, and
 * a run down to two memory readers can still call both at once. It only has to go when the run has
 * no tools at all.
 */
export type SystemPromptSection = {
  text: string;
  steers_tools?: readonly string[];
  needs_any_tool?: boolean;
};

/**
 * The text of every section this run's tools support, in order.
 *
 * `allowed_tool_names` omitted means an unrestricted run — a dashboard or Slack turn, where every
 * tool the channel offers is present — so nothing is filtered and the prompt is exactly what it
 * has always been. Present means it is the run's whole capability surface (see
 * `tools_allowed_on_this_run` in runtime_orchestrator.ts): a tool missing from it has no execute
 * closure the engine could ever dispatch, so no section may instruct the model to reach for it.
 */
export function keep_sections_this_run_can_use(
  sections: readonly SystemPromptSection[],
  allowed_tool_names: readonly string[] | undefined,
): string[] {
  const tools_on_this_run = allowed_tool_names ? new Set(allowed_tool_names) : null;
  return sections
    .filter((section) => {
      if (!tools_on_this_run) return true;
      if (section.needs_any_tool && tools_on_this_run.size === 0) return false;
      if (!section.steers_tools) return true;
      return section.steers_tools.some((tool_name) => tools_on_this_run.has(tool_name));
    })
    .map((section) => section.text);
}
