import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const max_decimal_places = 200;
const max_decimal_exponent = 10_000;
const max_power_exponent = 10_000n;

const input_schema = z.object({
  expression: z.string().min(1).max(4_000),
  decimal_places: z.number().int().min(0).max(max_decimal_places).default(40),
});

type rational_number = {
  denominator: bigint;
  numerator: bigint;
};

type operator_value = '+' | '-' | '*' | '/' | '^';

type token =
  | { type: 'number'; value: string }
  | { type: 'operator'; value: operator_value }
  | { type: 'percent' }
  | { type: 'left_paren' }
  | { type: 'right_paren' };

class calculation_error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const math_calculate_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'math-calculate-1',
  node_name: 'calculate',
  display_name: 'Calculate',
  description:
    'Evaluates arithmetic expressions with exact rational BigInt math. Use this for precise calculations with large integers, decimals, percentages, division, powers, and parentheses.',
  category: 'math',
  input_schema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description:
          'Arithmetic expression using numbers, decimals, percentages, +, -, *, /, ^, and parentheses. x, X, ×, and ÷ are accepted as multiplication/division symbols. A suffix like 15% is evaluated exactly as 15/100; for 15% of 4200, pass 15% * 4200.',
      },
      decimal_places: {
        type: 'number',
        description:
          'Decimal places for non-terminating divisions. Defaults to 40 and caps at 200. Exact fractions are always returned.',
      },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
      result: { type: 'string' },
      fraction: { type: 'string' },
      exact: { type: 'boolean' },
      rounded: { type: 'boolean' },
      decimal_places: { type: 'number' },
    },
    required: ['expression', 'result', 'fraction', 'exact', 'rounded', 'decimal_places'],
    additionalProperties: false,
  },
  app_name: 'math',
  required_connection: false,
  runtime_handler: 'math.calculate',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true, approval_display_fields: ['expression'] },
  validate_input: input_schema,
  async execute(input) {
    try {
      const value = evaluate_expression(input.expression);
      const decimal = rational_to_decimal(value, input.decimal_places);

      return {
        success: true,
        data: {
          expression: input.expression,
          result: decimal.result,
          fraction: `${value.numerator.toString()}/${value.denominator.toString()}`,
          exact: decimal.exact,
          rounded: !decimal.exact,
          decimal_places: input.decimal_places,
        },
        metadata: { calculation_engine: 'exact_rational_bigint' },
      };
    } catch (error) {
      if (error instanceof calculation_error) {
        return {
          success: false,
          error: { code: error.code, message: error.message },
        };
      }
      throw error;
    }
  },
};

function evaluate_expression(expression: string) {
  const parser = create_parser(tokenize_expression(expression));
  const result = parser.parse_expression();
  parser.expect_end();
  return result;
}

function tokenize_expression(expression: string) {
  const normalized = expression.replace(/[×xX]/gu, '*').replace(/÷/gu, '/').replace(/−/gu, '-');
  const tokens: token[] = [];
  let index = 0;

  while (index < normalized.length) {
    const character = normalized[index];
    if (character === undefined) break;
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    const number = parse_number_token(normalized.slice(index));
    if (number) {
      tokens.push({ type: 'number', value: number });
      index += number.length;
      continue;
    }
    if (character === '(') tokens.push({ type: 'left_paren' });
    else if (character === ')') tokens.push({ type: 'right_paren' });
    else if (character === '%') tokens.push({ type: 'percent' });
    else if (is_operator(character)) tokens.push({ type: 'operator', value: character });
    else throw new calculation_error('invalid_expression', `Unexpected character: ${character}`);
    index += 1;
  }

  return tokens;
}

function parse_number_token(input: string) {
  return input.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u)?.[0] ?? null;
}

function is_operator(value: string | undefined): value is operator_value {
  return value === '+' || value === '-' || value === '*' || value === '/' || value === '^';
}

function create_parser(tokens: token[]) {
  let position = 0;

  function current() {
    return tokens[position];
  }

  function consume() {
    const item = tokens[position];
    position += 1;
    return item;
  }

  function current_operator(...operators: operator_value[]) {
    const item = current();
    if (item?.type !== 'operator') return null;
    return operators.includes(item.value) ? item : null;
  }

  function parse_expression(): rational_number {
    let value = parse_term();
    let operator = current_operator('+', '-');
    while (operator) {
      consume();
      const right = parse_term();
      value = operator.value === '+' ? add(value, right) : subtract(value, right);
      operator = current_operator('+', '-');
    }
    return value;
  }

  function parse_term(): rational_number {
    let value = parse_unary();
    let operator = current_operator('*', '/');
    while (operator) {
      consume();
      const right = parse_unary();
      value = operator.value === '*' ? multiply(value, right) : divide(value, right);
      operator = current_operator('*', '/');
    }
    return value;
  }

  function parse_unary(): rational_number {
    const operator = current_operator('+', '-');
    if (!operator) {
      return parse_power();
    }
    consume();
    const value = parse_unary();
    return operator.value === '-' ? negate(value) : value;
  }

  function parse_power(): rational_number {
    let value = parse_percent();
    if (current_operator('^')) {
      consume();
      value = power(value, parse_unary());
    }
    return value;
  }

  function parse_percent(): rational_number {
    const value = parse_primary();
    if (current()?.type !== 'percent') return value;
    consume();
    return divide(value, { numerator: 100n, denominator: 1n });
  }

  function parse_primary(): rational_number {
    const item = consume();
    if (!item)
      throw new calculation_error('invalid_expression', 'Expected a number or parenthesis.');
    if (item.type === 'number') return parse_decimal(item.value);
    if (item.type !== 'left_paren') {
      throw new calculation_error('invalid_expression', 'Expected a number or parenthesis.');
    }
    const value = parse_expression();
    if (current()?.type !== 'right_paren') {
      throw new calculation_error('invalid_expression', 'Missing closing parenthesis.');
    }
    consume();
    return value;
  }

  function expect_end() {
    if (position !== tokens.length) {
      throw new calculation_error('invalid_expression', 'Unexpected trailing expression.');
    }
  }

  return { expect_end, parse_expression };
}

function parse_decimal(value: string) {
  const [coefficient = '', exponent_text] = value.toLowerCase().split('e');
  const exponent = exponent_text ? Number.parseInt(exponent_text, 10) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > max_decimal_exponent) {
    throw new calculation_error('invalid_number', `Exponent is too large: ${exponent_text}`);
  }
  const [integer_part = '', decimal_part = ''] = coefficient.split('.');
  const digits = `${integer_part}${decimal_part}`.replace(/^0+(?=\d)/u, '') || '0';
  const scale = decimal_part.length - exponent;

  if (scale >= 0) return normalize_rational(BigInt(digits), 10n ** BigInt(scale));
  return normalize_rational(BigInt(digits) * 10n ** BigInt(-scale), 1n);
}

function normalize_rational(numerator: bigint, denominator: bigint): rational_number {
  if (denominator === 0n) throw new calculation_error('division_by_zero', 'Division by zero.');
  const sign = denominator < 0n ? -1n : 1n;
  const signed_numerator = numerator * sign;
  const positive_denominator = denominator * sign;
  const divisor = greatest_common_divisor(abs_bigint(signed_numerator), positive_denominator);
  return {
    numerator: signed_numerator / divisor,
    denominator: positive_denominator / divisor,
  };
}

function add(left: rational_number, right: rational_number) {
  return normalize_rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtract(left: rational_number, right: rational_number) {
  return add(left, negate(right));
}

function multiply(left: rational_number, right: rational_number) {
  return normalize_rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: rational_number, right: rational_number) {
  return normalize_rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function negate(value: rational_number) {
  return { numerator: -value.numerator, denominator: value.denominator };
}

function power(base: rational_number, exponent: rational_number) {
  if (exponent.denominator !== 1n) {
    throw new calculation_error('unsupported_exponent', 'Exponent must be an integer.');
  }
  if (abs_bigint(exponent.numerator) > max_power_exponent) {
    throw new calculation_error('exponent_too_large', 'Exponent is too large.');
  }
  const magnitude = power_by_squaring(base, abs_bigint(exponent.numerator));
  if (exponent.numerator >= 0n) return magnitude;
  return divide({ numerator: 1n, denominator: 1n }, magnitude);
}

function power_by_squaring(base: rational_number, exponent: bigint) {
  let result = { numerator: 1n, denominator: 1n };
  let factor = base;
  let remaining = exponent;

  while (remaining > 0n) {
    if (remaining % 2n === 1n) result = multiply(result, factor);
    factor = multiply(factor, factor);
    remaining /= 2n;
  }

  return result;
}

function rational_to_decimal(value: rational_number, decimal_places: number) {
  const terminating = terminating_denominator(value.denominator);
  if (terminating) {
    const scale = Math.max(terminating.two_count, terminating.five_count);
    const scaled =
      value.numerator *
      2n ** BigInt(scale - terminating.two_count) *
      5n ** BigInt(scale - terminating.five_count);
    return { exact: true, result: format_scaled_integer(scaled, scale) };
  }

  return { exact: false, result: rounded_decimal(value, decimal_places) };
}

function terminating_denominator(denominator: bigint) {
  let rest = denominator;
  let two_count = 0;
  let five_count = 0;
  while (rest % 2n === 0n) {
    rest /= 2n;
    two_count += 1;
  }
  while (rest % 5n === 0n) {
    rest /= 5n;
    five_count += 1;
  }
  return rest === 1n ? { five_count, two_count } : null;
}

function rounded_decimal(value: rational_number, decimal_places: number) {
  const sign = value.numerator < 0n ? '-' : '';
  const scaled = abs_bigint(value.numerator) * 10n ** BigInt(decimal_places);
  const quotient = scaled / value.denominator;
  const remainder = scaled % value.denominator;
  const rounded = remainder * 2n >= value.denominator ? quotient + 1n : quotient;
  if (rounded === 0n) return format_scaled_integer(0n, decimal_places);
  return `${sign}${format_scaled_integer(rounded, decimal_places)}`;
}

function format_scaled_integer(unscaled: bigint, scale: number) {
  const sign = unscaled < 0n ? '-' : '';
  const digits = abs_bigint(unscaled)
    .toString()
    .padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${digits}`;

  const integer = digits.slice(0, -scale);
  const decimal = digits.slice(-scale).replace(/0+$/u, '');
  return decimal ? `${sign}${integer}.${decimal}` : `${sign}${integer}`;
}

function greatest_common_divisor(left: bigint, right: bigint) {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1n;
}

function abs_bigint(value: bigint) {
  return value < 0n ? -value : value;
}
