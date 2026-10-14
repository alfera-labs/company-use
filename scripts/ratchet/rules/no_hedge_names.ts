import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const hedge_prefix_pattern =
  /^_*(?:(?:ensure|handle|process|manage|do)(?:_[a-z0-9]|[A-Z0-9])|(?:ENSURE|HANDLE|PROCESS|MANAGE|DO)_[A-Z0-9])/u;
const hedge_suffix_pattern =
  /[a-zA-Z0-9](?:_(?:completely|fully|properly|safely|correctly)|(?:Completely|Fully|Properly|Safely|Correctly))$/u;

type NamedDeclaration =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.MethodDeclaration
  | ts.VariableDeclaration
  | ts.ParameterDeclaration
  | ts.BindingElement;

function is_named_declaration(node: ts.Node): node is NamedDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node)
  );
}

function read_declared_name(node: NamedDeclaration): string | undefined {
  const name = node.name;
  if (!name) return undefined;
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ? name.text.replace(/^#/u, '') : undefined;
}

function is_hedge_name(name: string): boolean {
  return hedge_prefix_pattern.test(name) || hedge_suffix_pattern.test(name);
}

function has_hedge_name(node: ts.Node): node is NamedDeclaration {
  if (!is_named_declaration(node)) return false;
  const name = read_declared_name(node);
  return name !== undefined && is_hedge_name(name);
}

function find_violations({ source_file }: RatchetRuleInput) {
  return find_nodes(source_file, has_hedge_name).map((node) => ({
    line: start_line_of(node, source_file),
    message: `hedge name "${read_declared_name(node)}"`,
  }));
}

export const no_hedge_names_rule: RatchetRule = {
  rule_id: 'no-hedge-names',
  summary:
    'No declared function, variable, method, or parameter name that starts with ensure/handle/process/manage/do or ends with completely/fully/properly/safely/correctly, in apps/** and packages/**, test files included.',
  why: 'A hedge word names the worry, not the work. `ensure_user` hides whether it creates, reads, or updates; `delete_fully` implies a delete that is not full. Ask "as opposed to what?": if the name implies a lesser twin, fix the one function and drop the word.',
  how_to_fix:
    'Name the operation from the caller view: create_x, set_x, get_or_create_x, create_x_if_absent (only when the condition is the contract), delete_x (one delete that owns the whole teardown), submit_form, on_click.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/app/src/sample.tsx',
      source_text:
        'function ensure_user() {}\nconst handleClick = () => {};\nclass A { process_items() {} }\nfunction f(manage_x: number, { doThing }: P) {}\nconst delete_fully = 1;\nconst saveSafely = 2;\n',
      expected_count: 7,
    },
    {
      file_path: 'apps/app/src/sample.tsx',
      source_text:
        'const processor = 1;\nconst handler_registry = {};\nfunction f(handle: number, done: boolean, document_id: string) {}\nconst el = <button onClick={handle_click} handle_x={1} />;\n',
      expected_count: 0,
    },
  ],
};
