export const agent_browser_binary = 'agent-browser';

const baked_browser_home_path = '/opt/coworker/browser';
const agent_browser_pointer_script_path = `${baked_browser_home_path}/pointer.js`;
export const agent_browser_live_view_relay_path = `${baked_browser_home_path}/live-view-relay.mjs`;

export const agent_browser_stream_port = 4849;
export const agent_browser_live_view_relay_port = 4820;

// Registered on every command with --init-script. The daemon dedupes by path, so it runs once
// per document no matter how many commands repeat it, and it persists across navigations and
// new tabs. `--init-script` is a global option, so it must precede the subcommand in argv.
export function with_pointer_init_script(argv: string[]): string[] {
  return ['--init-script', agent_browser_pointer_script_path, ...argv];
}

export type AgentBrowserCommandParseResult =
  | { ok: true; argv: string[] }
  | { ok: false; error_message: string };

export function shell_escape_argv(argv: string[]): string {
  return argv.map(shell_quote_argument).join(' ');
}

export function build_agent_browser_command(argv: string[]): string {
  return `${agent_browser_binary} ${shell_escape_argv(argv)}`;
}

export function parse_agent_browser_command_line(
  command_line: string,
): AgentBrowserCommandParseResult {
  const argv = parse_shell_like_argv(command_line.trim());
  if (!argv.ok) return argv;
  if (argv.argv.length === 0) {
    return { ok: false, error_message: 'The browser command cannot be empty.' };
  }
  const operator = argv.argv.find(is_shell_operator_token);
  if (operator) {
    return {
      ok: false,
      error_message: `The browser command cannot use shell operator "${operator}". Run one agent-browser command per tool call, or use the agent-browser batch command if the CLI supports it.`,
    };
  }
  return argv;
}

function shell_quote_argument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const characters_a_backslash_escapes_in_double_quotes = '"\\$`';

function parse_shell_like_argv(command_line: string): AgentBrowserCommandParseResult {
  const argv: string[] = [];
  let word = '';
  let word_has_begun = false;
  let open_quote = '';
  let position = 0;
  while (position < command_line.length) {
    const character = command_line.charAt(position);
    const keeps_next_character = backslash_keeps_next_character(command_line, position, open_quote);
    position += keeps_next_character ? 2 : 1;
    if (keeps_next_character) {
      word += command_line.charAt(position - 1);
      word_has_begun = true;
    } else if (open_quote) {
      if (character === open_quote) open_quote = '';
      else word += character;
    } else if (/\s/.test(character)) {
      if (word_has_begun) argv.push(word);
      word = '';
      word_has_begun = false;
    } else {
      word_has_begun = true;
      if (character === '"' || character === "'") open_quote = character;
      else word += character;
    }
  }
  if (open_quote) {
    const quote_name = open_quote === '"' ? 'double' : 'single';
    return {
      ok: false,
      error_message: `The browser command has an unterminated ${quote_name} quote.`,
    };
  }
  if (word_has_begun) argv.push(word);
  return { ok: true, argv };
}

function backslash_keeps_next_character(
  command_line: string,
  position: number,
  open_quote: string,
): boolean {
  if (command_line.charAt(position) !== '\\' || open_quote === "'") return false;
  const next_character = command_line.charAt(position + 1);
  if (next_character === '') return false;
  return (
    open_quote === '' || characters_a_backslash_escapes_in_double_quotes.includes(next_character)
  );
}

function is_shell_operator_token(token: string): boolean {
  return token === '&&' || token === '||' || token === '|' || token === ';' || token === '&';
}
