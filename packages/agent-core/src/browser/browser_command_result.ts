import type { BrowserExecResult } from '@agent-core/browser/types';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';

const command_timeout_exit_code = 124;
const command_not_found_exit_code = 127;

export function browser_command_failure(
  command: string,
  result: BrowserExecResult,
): RuntimeToolResult | undefined {
  if (is_browser_environment_unready(result)) {
    return {
      ok: false,
      error_code: 'browser_not_installed',
      error_message:
        "The browser is unavailable in this session's sandbox — agent-browser or its Chrome isn't ready. The sandbox is pinned per chat, so a chat started before the browser was set up keeps its old sandbox — start a NEW chat to get a fresh one. If a new chat also fails, rebuild the session template (infra/e2b/nextjs-template.ts → `tsx infra/e2b/build-template.ts`).",
    };
  }
  if (result.exit_code === command_timeout_exit_code) {
    return {
      ok: false,
      error_code: 'browser_command_timeout',
      error_message: browser_command_timeout_message(command),
      content: [{ type: 'text', text: browser_output_text(result) }],
    };
  }
  return undefined;
}

function browser_command_timeout_message(command: string) {
  const base = `Browser command timed out: ${command}`;
  if (!command.includes('networkidle')) return base;
  return `${base}. This page may never reach network idle (polling/streaming apps don't) — wait on a concrete condition instead: \`wait --text "…"\` or \`wait --selector "…"\`, or just proceed with a snapshot.`;
}

function is_browser_environment_unready(result: BrowserExecResult): boolean {
  if (result.exit_code === 0) return false;
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    result.exit_code === command_not_found_exit_code &&
    text.includes('agent-browser') &&
    (text.includes('not found') || text.includes('no such file'))
  ) {
    return true;
  }
  return (
    text.includes('chrome not found') ||
    text.includes('auto-launch failed') ||
    text.includes('run `agent-browser install`')
  );
}

export function browser_output_text(result: BrowserExecResult): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.exit_code === 0) return stdout;
  const parts = [
    stdout,
    stderr ? `[exit ${result.exit_code}] ${stderr}` : `[exit ${result.exit_code}]`,
  ];
  return parts.filter(Boolean).join('\n');
}
