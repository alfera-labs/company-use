const log_levels = ['silent', 'error', 'warn', 'info', 'debug'] as const;
type LogLevel = (typeof log_levels)[number];

const level_rank: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function default_level(): LogLevel {
  return process.env.NODE_ENV === 'test' ? 'warn' : 'info';
}

function active_level(): LogLevel {
  const requested = process.env.LOG_LEVEL?.trim().toLowerCase();
  return is_log_level(requested) ? requested : default_level();
}

function is_log_level(value: string | undefined): value is LogLevel {
  return value !== undefined && (log_levels as readonly string[]).includes(value);
}

function is_shown(level: LogLevel): boolean {
  return level_rank[level] <= level_rank[active_level()];
}

type ConsoleWrite = (...args: unknown[]) => void;

function write(
  level: LogLevel,
  to_console: ConsoleWrite,
  tag: string,
  message: string,
  context?: unknown,
) {
  if (!is_shown(level)) return;
  const line = `[${tag}] ${message}`;
  if (context === undefined) to_console(line);
  else to_console(`${line} ${serialize_log_context(context)}`);
}

// The context lands on the SAME stdout/stderr line as the message, as compact JSON. Passing the
// object through to console.* pretty-prints it across several lines, which Cloud Run ingests as
// separate log entries — the message line loses its run_id/workspace_id and stops being
// queryable. One line keeps every field greppable next to its sentence.
function serialize_log_context(context: unknown): string {
  try {
    return JSON.stringify(context, log_context_replacer) ?? String(context);
  } catch {
    return String(context);
  }
}

function log_context_replacer(_key: string, value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export type Logger = {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
};

export function create_logger(tag: string): Logger {
  return {
    debug: (message, context) => write('debug', console.debug, tag, message, context),
    info: (message, context) => write('info', console.info, tag, message, context),
    warn: (message, context) => write('warn', console.warn, tag, message, context),
    error: (message, context) => write('error', console.error, tag, message, context),
  };
}
