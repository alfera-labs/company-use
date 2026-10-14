import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

function is_in_loop_body(node: ts.Node): boolean {
  let child = node;
  let parent = node.parent;
  while (parent && !ts.isFunctionLike(parent)) {
    if (ts.isIterationStatement(parent, false) && parent.statement === child) return true;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

function is_await_in_loop(node: ts.Node): boolean {
  return ts.isAwaitExpression(node) && is_in_loop_body(node);
}

function find_violations({ source_file }: RatchetRuleInput) {
  return find_nodes(source_file, is_await_in_loop).map((node) => ({
    line: start_line_of(node, source_file),
    message: '`await` inside a loop body',
  }));
}

export const no_await_in_loop_rule: RatchetRule = {
  rule_id: 'no-await-in-loop',
  summary:
    'No `await` in the body of a for, for-in, for-of, while, or do-while loop in apps/** and packages/**. A `for await` header and a nested function are fine. Test files are exempt.',
  why: 'An await in a loop runs I/O one item at a time. It hides N+1 queries and makes the time grow with the item count.',
  how_to_fix:
    'Use one bulk query, or Promise.all over a bounded batch. If the order truly matters, move the loop into a named function that says so.',
  applies_to: is_source_file_outside_tests,
  find_violations,
  self_test_samples: [
    {
      file_path: 'packages/core/src/sample.ts',
      source_text:
        'async function f(items) {\n  for (const item of items) { await save(item); }\n  while (more()) await next();\n  do { await tick(); } while (x);\n  for (let i = 0; i < 3; i++) { if (i) { await wait(i); } }\n}\n',
      expected_count: 4,
    },
    {
      file_path: 'packages/core/src/sample.ts',
      source_text:
        'async function f(items) {\n  for await (const item of stream()) { use(item); }\n  for (const item of items) { queue.push(async () => { await save(item); }); }\n  for (const item of await load()) use(item);\n  await Promise.all(items.map((item) => save(item)));\n}\n',
      expected_count: 0,
    },
  ],
};
