import { math_calculate_tool } from '@runtime-platform/tools/definitions/math_calculate';
import { describe, expect, it } from 'vitest';

type calculation_data = {
  decimal_places: number;
  exact: boolean;
  expression: string;
  fraction: string;
  result: string;
  rounded: boolean;
};

async function calculate(input: { decimal_places?: number; expression: string }) {
  return math_calculate_tool.execute(math_calculate_tool.validate_input.parse(input));
}

function read_calculation_data(result: Awaited<ReturnType<typeof calculate>>) {
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data as calculation_data;
}

function read_error(result: Awaited<ReturnType<typeof calculate>>) {
  if (result.success) {
    throw new Error('Expected calculation to fail.');
  }
  return result.error;
}

describe('math calculate tool', () => {
  const exact_cases = [
    {
      name: 'adds above the JavaScript safe integer range',
      expression: '9007199254740993 + 1',
      result: '9007199254740994',
      fraction: '9007199254740994/1',
    },
    {
      name: 'keeps tiny decimals exact when multiplied by huge powers of ten',
      expression: '0.0000000000000000001 * 10000000000000000000',
      result: '1',
      fraction: '1/1',
    },
    {
      name: 'squares very large integers',
      expression: '999999999999999999999999999999 * 999999999999999999999999999999',
      result: '999999999999999999999999999998000000000000000000000000000001',
      fraction: '999999999999999999999999999998000000000000000000000000000001/1',
    },
    {
      name: 'handles scientific notation exactly',
      expression: '1.23e5 + 4.56e-3',
      result: '123000.00456',
      fraction: '1537500057/12500',
    },
    {
      name: 'accepts common multiplication and division symbols',
      expression: '(7 × 6) ÷ 4',
      result: '10.5',
      fraction: '21/2',
    },
    {
      name: 'evaluates a percentage as an exact fraction',
      expression: '20%',
      result: '0.2',
      fraction: '1/5',
    },
    {
      name: 'calculates a percentage of a business amount',
      expression: '15% * 4200',
      result: '630',
      fraction: '630/1',
    },
    {
      name: 'calculates a discounted amount',
      expression: '4200 * (1 - 15%)',
      result: '3570',
      fraction: '3570/1',
    },
    {
      name: 'calculates growth from a percentage rate',
      expression: '125000 * (1 + 7.5%)',
      result: '134375',
      fraction: '134375/1',
    },
    {
      name: 'calculates a percentage rate from exact counts',
      expression: '42 / 1200 * 100',
      result: '3.5',
      fraction: '7/2',
    },
    {
      name: 'reduces exact fractions',
      expression: '10 / 20',
      result: '0.5',
      fraction: '1/2',
    },
    {
      name: 'evaluates nested parentheses',
      expression: '((2 + 3) * (4 - 1)) / 5',
      result: '3',
      fraction: '3/1',
    },
    {
      name: 'keeps exponentiation right-associative',
      expression: '2^3^2',
      result: '512',
      fraction: '512/1',
    },
  ];

  for (const item of exact_cases) {
    it(item.name, async () => {
      const data = read_calculation_data(await calculate({ expression: item.expression }));

      expect(data).toMatchObject({
        result: item.result,
        fraction: item.fraction,
        exact: true,
        rounded: false,
      });
    });
  }

  const invalid_cases = [
    {
      name: 'rejects natural date wording instead of guessing',
      expression: 'today - 30 days',
      code: 'invalid_expression',
    },
    {
      name: 'rejects non-integer exponents',
      expression: '4 ^ 0.5',
      code: 'unsupported_exponent',
    },
    {
      name: 'rejects exponents above the configured power cap',
      expression: '2 ^ 10001',
      code: 'exponent_too_large',
    },
    {
      name: 'rejects decimal scientific exponents above the configured cap',
      expression: '1e10001',
      code: 'invalid_number',
    },
    {
      name: 'rejects missing closing parentheses',
      expression: '(1 + 2',
      code: 'invalid_expression',
    },
    {
      name: 'rejects repeated percent suffixes',
      expression: '20%%',
      code: 'invalid_expression',
    },
  ];

  for (const item of invalid_cases) {
    it(item.name, async () => {
      const error = read_error(await calculate({ expression: item.expression }));

      expect(error.code).toBe(item.code);
    });
  }

  it('multiplies large decimals without JavaScript Number rounding', async () => {
    const data = read_calculation_data(
      await calculate({ expression: '1000000 x 29182394949.9999' }),
    );

    expect(data).toEqual({
      expression: '1000000 x 29182394949.9999',
      result: '29182394949999900',
      fraction: '29182394949999900/1',
      exact: true,
      rounded: false,
      decimal_places: 40,
    });
  });

  it('adds decimals exactly', async () => {
    const data = read_calculation_data(await calculate({ expression: '0.1 + 0.2' }));

    expect(data).toMatchObject({
      result: '0.3',
      fraction: '3/10',
      exact: true,
      rounded: false,
    });
  });

  it('returns an exact fraction when the decimal output is rounded', async () => {
    const data = read_calculation_data(
      await calculate({ expression: '1 / 3', decimal_places: 12 }),
    );

    expect(data).toMatchObject({
      result: '0.333333333333',
      fraction: '1/3',
      exact: false,
      rounded: true,
      decimal_places: 12,
    });
  });

  it('keeps normal arithmetic precedence for powers and unary minus', async () => {
    const negative_square = read_calculation_data(await calculate({ expression: '-2^2' }));
    const grouped_square = read_calculation_data(await calculate({ expression: '(-2)^2' }));

    expect(negative_square.result).toBe('-4');
    expect(grouped_square.result).toBe('4');
  });

  it('does not print negative zero when a small negative value rounds to zero', async () => {
    const data = read_calculation_data(
      await calculate({ expression: '-1 / 3000', decimal_places: 2 }),
    );

    expect(data.result).toBe('0');
  });

  it('reports division by zero without hiding the failure', async () => {
    const result = await calculate({ expression: '1 / 0' });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'division_by_zero' },
    });
  });

  it('rejects decimal precision outside the tool limit before execution', () => {
    expect(() =>
      math_calculate_tool.validate_input.parse({ expression: '1 / 3', decimal_places: 201 }),
    ).toThrow();
  });
});
