import type { SessionEnv } from '@agent-core/environment';

/** A sandbox that is attached and serves no preview is not offered the preview tool. */
export function tools_the_sandbox_serves<Tool extends { tool_name: string }>(
  tools: Tool[],
  environment: SessionEnv | undefined,
) {
  if (!environment || environment.start_preview) return tools;
  return tools.filter((tool) => tool.tool_name !== 'workspace-preview');
}
