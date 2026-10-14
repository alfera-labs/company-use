import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

function is_empty_catch_clause(node: ts.Node): boolean {
  return ts.isCatchClause(node) && node.block.statements.length === 0;
}

function is_discarding_body(body: ts.ConciseBody): boolean {
  if (ts.isBlock(body)) return body.statements.length === 0;
  if (body.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(body)) return true;
  return ts.isIdentifier(body) && body.text === 'undefined';
}

function is_discarding_catch_call(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const handler = node.arguments[0];
  if (node.expression.name.text !== 'catch' || !handler) return false;
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  return is_discarding_body(handler.body);
}

function find_violations({ source_file }: RatchetRuleInput) {
  const is_silent_catch = (node: ts.Node) => is_empty_catch_clause(node) || is_discarding_catch_call(node);
  return find_nodes(source_file, is_silent_catch).map((node) => ({
    line: start_line_of(ts.isCallExpression(node) ? (node.arguments[0] ?? node) : node, source_file),
    message: ts.isCatchClause(node) ? 'empty catch block' : '`.catch` handler drops the error',
  }));
}

export const no_empty_catch_rule: RatchetRule = {
  rule_id: 'no-empty-catch',
  summary:
    'No empty catch block and no `.catch(() => {})`, `.catch(() => undefined)`, or `.catch(() => null)` in apps/** and packages/**, test files included.',
  why: 'A swallowed error is a silent failure. Nobody sees it in logs, status fields, or the UI, so the bug lives on.',
  how_to_fix:
    'Handle the error: log it with context, record it on the status field, rethrow a named error, or return a typed failure. If one error is expected, catch only that error and rethrow the rest.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/sample.ts',
      source_text:
        'try { a(); } catch {}\ntry { a(); } catch (error) { /* ignore */ }\np.catch(() => {});\np.catch(() => undefined);\np.catch(function () {});\np.catch(() => null);\n',
      expected_count: 6,
    },
    {
      file_path: 'packages/core/src/sample.ts',
      source_text: 'try { a(); } catch (error) { log(error); }\np.catch((error) => report(error));\np.then(() => {});\n',
      expected_count: 0,
    },
  ],
};
