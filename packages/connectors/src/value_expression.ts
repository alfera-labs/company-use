const operator_names = ['$', '$map', '$default', '$literal', '$join'] as const;
type OperatorName = (typeof operator_names)[number];

export type ValueScope = Record<string, unknown>;

export class ValueExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueExpressionError';
  }
}

export function is_plain_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolve_scope_path(scope: ValueScope, dotted_path: string): unknown {
  let current: unknown = scope;
  for (const step of dotted_path.split('.')) {
    if (!is_plain_record(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

function find_operator(record: Record<string, unknown>): OperatorName | null {
  const keys = Object.keys(record);
  const dollar_keys = keys.filter((key) => key.startsWith('$'));
  if (dollar_keys.length === 0) return null;
  const name = dollar_keys[0] as string;
  if (keys.length > 1) {
    throw new ValueExpressionError(
      `A value expression using ${name} must have no other keys: ${keys.join(', ')}. Use $literal for a JSON object that really has a $ key.`,
    );
  }
  if (!(operator_names as readonly string[]).includes(name)) {
    throw new ValueExpressionError(
      `Unknown value expression operator ${name}. Known operators: ${operator_names.join(', ')}.`,
    );
  }
  return name as OperatorName;
}

function evaluate_reference(argument: unknown, scope: ValueScope) {
  if (typeof argument !== 'string') {
    throw new ValueExpressionError(
      '$ takes a dotted path string, for example { "$": "input.id" }.',
    );
  }
  return resolve_scope_path(scope, argument);
}

function evaluate_map(argument: unknown, scope: ValueScope) {
  if (!is_plain_record(argument) || !('from' in argument) || !('to' in argument)) {
    throw new ValueExpressionError('$map takes { "from": <expression>, "to": <expression> }.');
  }
  const source = evaluate_value_expression(argument.from, scope);
  if (source === undefined || source === null) return [];
  if (!Array.isArray(source)) {
    throw new ValueExpressionError(
      `$map needs an array to map over, and its "from" produced ${typeof source}. A bare string is a literal — write { "$": "response.items" } to read a path.`,
    );
  }
  return source.map((item) =>
    evaluate_value_expression(argument.to, { ...scope, item, parent: scope.item }),
  );
}

function evaluate_default(argument: unknown, scope: ValueScope) {
  if (!Array.isArray(argument) || argument.length === 0) {
    throw new ValueExpressionError('$default takes a non-empty array of expressions.');
  }
  let last: unknown;
  for (const candidate of argument) {
    last = evaluate_value_expression(candidate, scope);
    if (last !== undefined && last !== null) return last;
  }
  return last;
}

function is_joinable_part(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim().length > 0;
}

function evaluate_join(argument: unknown, scope: ValueScope) {
  if (!is_plain_record(argument) || !Array.isArray(argument.parts)) {
    throw new ValueExpressionError(
      '$join takes { "parts": [<expression>, ...], "separator": " " }.',
    );
  }
  const separator = argument.separator ?? ' ';
  if (typeof separator !== 'string') {
    throw new ValueExpressionError('$join separator must be a string.');
  }
  const parts = argument.parts
    .map((part) => evaluate_value_expression(part, scope))
    .filter(is_joinable_part)
    .map((part) => String(part).trim());
  return parts.length > 0 ? parts.join(separator) : null;
}

export function evaluate_value_expression(expression: unknown, scope: ValueScope): unknown {
  if (Array.isArray(expression)) {
    return expression.map((entry) => evaluate_value_expression(entry, scope));
  }
  if (!is_plain_record(expression)) return expression;

  const operator = find_operator(expression);
  if (operator === '$') return evaluate_reference(expression.$, scope);
  if (operator === '$map') return evaluate_map(expression.$map, scope);
  if (operator === '$default') return evaluate_default(expression.$default, scope);
  if (operator === '$literal') return expression.$literal;
  if (operator === '$join') return evaluate_join(expression.$join, scope);

  const evaluated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(expression)) {
    const result = evaluate_value_expression(value, scope);
    if (result !== undefined) evaluated[key] = result;
  }
  return evaluated;
}

export function fill_path_template(template: string, scope: ValueScope): string {
  return template.replace(/\{([^{}]+)\}/gu, (_match, dotted_path: string) => {
    const value = resolve_scope_path(scope, dotted_path.trim());
    if (value === undefined || value === null) {
      throw new ValueExpressionError(
        `The path placeholder {${dotted_path}} has no value in this call.`,
      );
    }
    return encodeURIComponent(String(value));
  });
}

export function evaluate_expression_record(
  expressions: Record<string, unknown> | undefined,
  scope: ValueScope,
): Record<string, unknown> {
  const evaluated: Record<string, unknown> = {};
  for (const [name, expression] of Object.entries(expressions ?? {})) {
    const value = evaluate_value_expression(expression, scope);
    if (value !== undefined && value !== null) evaluated[name] = value;
  }
  return evaluated;
}
