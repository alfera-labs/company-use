import { parse_agent_browser_command_line } from '@agent-core/browser/agent_browser_command';
import {
  browser_command_failure,
  browser_output_text,
} from '@agent-core/browser/browser_command_result';
import { find_browser_guide_section } from '@agent-core/browser/browser_operating_guide';
import {
  execute_screenshot_command,
  is_standalone_screenshot_command,
} from '@agent-core/browser/browser_screenshot';
import { build_browser_skill_prompt } from '@agent-core/browser/browser_skill_prompt';
import type { BrowserSession } from '@agent-core/browser/types';
import type {
  RuntimeJsonSchema,
  RuntimeToolContext,
  RuntimeToolDefinition,
} from '@agent-core/tools/runtime_tool';
import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import { format_error_message } from '@coworker/shared';

export const browser_tool_name = 'browser';

const browser_tool_input_schema: RuntimeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['command'],
  properties: {
    command: {
      type: 'string',
      description:
        'One agent-browser command line without the leading `agent-browser`, e.g. `open https://example.com`, `snapshot -i`, `click @e5`, `fill @e3 "text"`, or `batch ...` when supported by the CLI.',
    },
  },
};

const browser_tool_description = build_browser_tool_description();

function build_browser_tool_description(): string {
  const essentials = ['precision', 'obstacles', 'vision']
    .flatMap((section_key) => find_browser_guide_section(section_key).rules)
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join(' ');
  return [
    'Operate a real headless browser through the agent-browser CLI. Submit ONE command per call in `command`, without the leading `agent-browser`.',
    'Core loop: `open <url>` → `snapshot -i` (interactive elements; each is listed as `[ref=eN]`, which you address as `@eN`) → act on a ref (`click @e5`, `fill @e3 "text"`, `type "text"`, `select @e2 "value"`) → re-run `snapshot -i` after any page change, because refs go stale. Never act by pixel coordinates.',
    'Common commands: open <url> · snapshot -i [-c] · click @eN · fill @eN "text" · type "text" · select @eN "value" · get url · get text @eN · read [url] · wait --load networkidle · wait --text "…" · tab new --label <x> · tab <id|label> · screenshot --annotate · state save/load. Run `commands` for the full command reference or `skills get core` for the full skill. Do not use shell chains like `&&`.',
    `Operating rules: ${essentials}`,
    'Load the operate-the-browser skill (runtime-load_skill-1) for the full operating guide, and pursue the task until it is fully achieved and verified.',
  ].join('\n\n');
}

const stalled_tab_recovery_limit = 3;

type StalledTabRecovery = { count: number };

export function create_browser_tool(session: BrowserSession): RuntimeToolDefinition {
  const recovery: StalledTabRecovery = { count: 0 };
  return {
    tool_name: browser_tool_name,
    description: browser_tool_description,
    input_schema: browser_tool_input_schema,
    execution_mode: 'sequential',
    metadata: {
      display_name: 'Browser',
      source_package: '@agent-core',
      browser_sandbox_id: session.id,
    },
    execute: (input, context) => execute_browser_command(session, input, context, recovery),
  };
}

export async function load_browser_skill_prompt(session: BrowserSession): Promise<string> {
  const result = await session.exec(['skills', 'get', 'core']);
  if (result.exit_code !== 0 || !result.stdout.trim()) {
    throw new Error(`Could not load agent-browser core skill: ${result.stderr || 'empty output'}`);
  }
  return build_browser_skill_prompt(result.stdout);
}

async function execute_browser_command(
  session: BrowserSession,
  input: unknown,
  context: RuntimeToolContext,
  recovery: StalledTabRecovery,
): Promise<RuntimeToolResult> {
  const command = read_browser_command(input);
  if (!command) {
    return {
      ok: false,
      error_code: 'invalid_browser_input',
      error_message: 'The browser tool needs a non-empty "command" string.',
    };
  }

  const exec_options = context.signal === undefined ? {} : { signal: context.signal };
  try {
    const parsed = parse_agent_browser_command_line(command);
    if (!parsed.ok) {
      return {
        ok: false,
        error_code: 'invalid_browser_command',
        error_message: parsed.error_message,
      };
    }

    if (session.read_bytes && is_standalone_screenshot_command(command)) {
      return await execute_screenshot_command(session, command, exec_options);
    }

    const result = await session.exec(parsed.argv, exec_options);
    const failure = browser_command_failure(command, result);
    if (failure && !failure.ok && failure.error_code === 'browser_command_timeout') {
      return await run_on_a_fresh_tab(session, {
        command,
        argv: parsed.argv,
        timeout: failure,
        exec_options,
        recovery,
      });
    }
    if (failure) return failure;
    return browser_command_success(result);
  } catch (error) {
    return {
      ok: false,
      error_code: 'browser_unavailable',
      error_message: format_error_message(error),
    };
  }
}

async function run_on_a_fresh_tab(
  session: BrowserSession,
  input: {
    command: string;
    argv: string[];
    timeout: Extract<RuntimeToolResult, { ok: false }>;
    exec_options: { signal?: AbortSignal };
    recovery: StalledTabRecovery;
  },
): Promise<RuntimeToolResult> {
  if (input.recovery.count >= stalled_tab_recovery_limit) return input.timeout;
  input.recovery.count += 1;

  const fresh_tab = await session.exec(
    ['tab', 'new', '--label', `recovered-${input.recovery.count}`],
    input.exec_options,
  );
  if (fresh_tab.exit_code !== 0) return input.timeout;

  if (!is_navigation_command(input.argv)) {
    return {
      ok: false,
      error_code: 'browser_tab_stalled',
      error_message: `Browser command timed out: ${input.command}. The tab it ran against had stopped responding, so it was closed off and a fresh tab is now open and active. That tab is blank — \`open <url>\` to load your page again, then carry on. Repeating the timed-out command before re-opening the page will not work.`,
    };
  }

  const retry = await session.exec(input.argv, input.exec_options);
  const retry_failure = browser_command_failure(input.command, retry);
  if (retry_failure) return retry_failure;
  return browser_command_success(retry);
}

function is_navigation_command(argv: string[]): boolean {
  const [name] = argv;
  return name === 'open' || (name === 'read' && argv.length > 1);
}

function browser_command_success(result: {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}): RuntimeToolResult {
  return {
    ok: true,
    content_text: browser_output_text(result),
    metadata: { exit_code: result.exit_code, duration_ms: result.duration_ms },
  };
}

export function read_browser_command(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command.trim() : '';
}
