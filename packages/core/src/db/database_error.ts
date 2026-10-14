// Postgres failures arrive wrapped, and the wrapper is the useless half.
//
// Drizzle raises DrizzleQueryError whose `message` is only the SQL text and the bound parameters;
// the driver's own error — SQLSTATE, the constraint that rejected the row, the DETAIL line naming
// the colliding key — hangs off `cause`. Code that stores `error.message` therefore stores a
// kilobyte of query dump and no diagnosis: the failed run's row says
// "Failed query: WITH batch ..." with an empty error_code, and identifying a one-line unique
// violation takes a full reproduction.
//
// Read the chain instead. `find_database_error_details` is for code that must branch on a specific
// SQLSTATE; `describe_error_with_cause` is for anything that persists or logs a failure.

export type DatabaseErrorDetails = {
  readonly code: string | undefined;
  readonly constraint_name: string | undefined;
  readonly detail: string | undefined;
  readonly message: string;
};

type PostgresErrorShape = {
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  detail?: unknown;
  message?: unknown;
};

export function find_database_error_details(error: unknown): DatabaseErrorDetails | undefined {
  let link: unknown = error;

  for (let depth = 0; link instanceof Error && depth < 8; depth += 1) {
    const candidate = link as Error & PostgresErrorShape;
    const code = typeof candidate.code === 'string' && candidate.code ? candidate.code : undefined;
    if (code) {
      return {
        code,
        constraint_name: read_constraint_name(candidate),
        detail:
          typeof candidate.detail === 'string' && candidate.detail ? candidate.detail : undefined,
        message: candidate.message,
      };
    }
    link = candidate.cause;
  }

  return undefined;
}

function read_constraint_name(error: PostgresErrorShape) {
  const name = error.constraint ?? error.constraint_name;
  return typeof name === 'string' && name ? name : undefined;
}

export function is_unique_violation_of(error: unknown, index_name: string): boolean {
  const details = find_database_error_details(error);
  return details?.code === '23505' && details.constraint_name === index_name;
}

export function describe_error_with_cause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const details = find_database_error_details(error);
  if (!details) return error.message;

  const cause_text = [
    `[${details.code}]`,
    details.message,
    details.detail,
    details.constraint_name ? `constraint=${details.constraint_name}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return cause_text === error.message
    ? cause_text
    : `${cause_text} — while running: ${truncate_wrapper_message(error.message)}`;
}

function truncate_wrapper_message(message: string) {
  const limit = 300;
  if (message.length <= limit) return message;
  return `${message.slice(0, limit)}… [${message.length - limit} more chars omitted]`;
}
