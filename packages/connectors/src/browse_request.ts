import { evaluate_value_expression, resolve_scope_path } from '@connectors/value_expression';

export type BrowseRequestScope = {
  parent_id?: string | undefined;
  query?: string | undefined;
  cursor?: string | undefined;
};

function is_plain_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fill_one_placeholder(scope: Record<string, unknown>, dotted_path: string): string | null {
  const value = resolve_scope_path(scope, dotted_path.trim());
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export function fill_browse_template(
  template: string,
  scope: Record<string, unknown>,
): string | undefined {
  let missing = false;
  const filled = template.replace(/\{([^{}]+)\}/gu, (_match, dotted_path: string) => {
    const filled_value = fill_one_placeholder(scope, dotted_path);
    if (filled_value === null) {
      missing = true;
      return '';
    }
    return filled_value;
  });
  return missing ? undefined : filled;
}

function evaluate_browse_expression(expression: unknown, scope: Record<string, unknown>): unknown {
  if (typeof expression === 'string') return fill_browse_template(expression, scope);
  if (Array.isArray(expression)) {
    return expression.map((entry) => evaluate_browse_expression(entry, scope));
  }
  if (!is_plain_record(expression)) return expression;
  const keys = Object.keys(expression);
  if (keys.length === 1 && keys[0] === '$default') {
    return evaluate_browse_default(expression.$default, scope);
  }
  if (keys.length === 1 && keys[0] === '$literal') return expression.$literal;
  if (keys.some((key) => key.startsWith('$'))) return evaluate_value_expression(expression, scope);
  return evaluate_browse_record(expression, scope);
}

function evaluate_browse_default(candidates: unknown, scope: Record<string, unknown>): unknown {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('$default takes a non-empty array of expressions.');
  }
  let last: unknown;
  for (const candidate of candidates) {
    last = evaluate_browse_expression(candidate, scope);
    if (last !== undefined && last !== null) return last;
  }
  return last;
}

function evaluate_browse_record(
  record: Record<string, unknown>,
  scope: Record<string, unknown>,
): Record<string, unknown> {
  const evaluated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const result = evaluate_browse_expression(value, scope);
    if (result !== undefined) evaluated[key] = result;
  }
  return evaluated;
}

export function evaluate_browse_request(
  browse_request: Record<string, unknown>,
  scope: BrowseRequestScope,
): Record<string, unknown> {
  const value_scope = Object.fromEntries(
    Object.entries(scope).filter(([, value]) => value !== undefined && value !== null),
  );
  const evaluated: Record<string, unknown> = {};
  for (const [param, expression] of Object.entries(browse_request)) {
    const value = evaluate_browse_expression(expression, value_scope);
    if (value !== undefined && value !== null) evaluated[param] = value;
  }
  return evaluated;
}
