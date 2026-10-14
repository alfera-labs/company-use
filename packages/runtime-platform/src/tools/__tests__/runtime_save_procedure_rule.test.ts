import type { SessionEnv } from '@agent-core/environment';
import { runtime_save_procedure_rule_tool } from '@runtime-platform/tools/definitions/runtime_save_procedure_rule';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { describe, expect, it } from 'vitest';

function fake_environment(files: Map<string, string>) {
  return {
    read_file: async (path: string) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`no such file: ${path}`);
      return contents;
    },
    write_file: async (path: string, contents: string) => {
      files.set(path, contents);
    },
  } as unknown as SessionEnv;
}

function context_with(files: Map<string, string>): RuntimeToolExecutionContext {
  return {
    db: undefined as never,
    workspace_id: 'ws_test',
    session_id: 'ses_test',
    run_id: 'run_test',
    actor_id: 'user_test',
    environment: fake_environment(files),
  };
}

describe('runtime-save_procedure_rule-1', () => {
  it('creates the rules file on the first rule and returns a receipt', async () => {
    const files = new Map<string, string>();

    const result = await runtime_save_procedure_rule_tool.execute(
      {
        procedure_slug: 'weekly-ordering',
        rule_key: 'order_minimum_units.northwind',
        rule_value: '500',
        customer_quote: 'northwind is 500 units',
      },
      context_with(files),
    );

    expect(result).toMatchObject({
      success: true,
      data: { outcome: 'added', total_rules: 1 },
    });
    expect((result as { data: { rules_path: string } }).data.rules_path).toContain(
      'skills/weekly-ordering/rules.md',
    );
    expect(files.get('skills/weekly-ordering/rules.md')).toContain(
      'order_minimum_units.northwind: 500  # "northwind is 500 units"',
    );
  });

  it('replaces a corrected rule and reports what it used to say', async () => {
    const files = new Map<string, string>();
    const context = context_with(files);
    await runtime_save_procedure_rule_tool.execute(
      { procedure_slug: 'p', rule_key: 'discount', rule_value: '30%' },
      context,
    );

    const corrected = await runtime_save_procedure_rule_tool.execute(
      { procedure_slug: 'p', rule_key: 'discount', rule_value: '15%' },
      context,
    );

    expect(corrected).toMatchObject({
      success: true,
      data: { outcome: 'replaced', previous_value: '30%', total_rules: 1 },
    });
    const file = files.get('skills/p/rules.md') ?? '';
    expect(file).toContain('discount: 15%');
    expect(file).not.toContain('30%');
  });

  it('reports unchanged without rewriting the file', async () => {
    const files = new Map<string, string>();
    const context = context_with(files);
    await runtime_save_procedure_rule_tool.execute(
      { procedure_slug: 'p', rule_key: 'seasonality', rule_value: 'off' },
      context,
    );
    const before = files.get('skills/p/rules.md');

    const again = await runtime_save_procedure_rule_tool.execute(
      { procedure_slug: 'p', rule_key: 'seasonality', rule_value: 'off' },
      context,
    );

    expect(again).toMatchObject({ success: true, data: { outcome: 'unchanged' } });
    expect(files.get('skills/p/rules.md')).toBe(before);
  });

  it('refuses when the workspace files are unavailable, so "saved" cannot be claimed', async () => {
    const { environment: _omitted, ...context_without_files } = context_with(new Map());
    const result = await runtime_save_procedure_rule_tool.execute(
      { procedure_slug: 'p', rule_key: 'k', rule_value: 'v' },
      context_without_files,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'workspace_files_unavailable' },
    });
  });
});
