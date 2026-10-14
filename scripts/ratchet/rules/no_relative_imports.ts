import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const package_root_config_pattern = /^(?:apps|packages)\/[^/]+\/[^/]+\.config\.[cm]?ts$/u;
const relative_specifier_pattern = /^\.\.?(?:\/|$)/u;

function read_module_specifier(node: ts.Node): ts.Node | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0];
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  return undefined;
}

function read_relative_specifier(node: ts.Node): string | undefined {
  const specifier = read_module_specifier(node);
  if (!specifier || !ts.isStringLiteralLike(specifier)) return undefined;
  return relative_specifier_pattern.test(specifier.text) ? specifier.text : undefined;
}

function find_violations({ source_file }: RatchetRuleInput) {
  const has_relative_specifier = (node: ts.Node) => read_relative_specifier(node) !== undefined;
  return find_nodes(source_file, has_relative_specifier).map((node) => ({
    line: start_line_of(node, source_file),
    message: `relative import "${read_relative_specifier(node)}"`,
  }));
}

export const no_relative_imports_rule: RatchetRule = {
  rule_id: 'no-relative-imports',
  summary:
    'No `./` or `../` specifiers in import, export, import(), or import type in apps/** and packages/**, test files included. Exempt: *.config.ts files at a package root (vite, next, vitest, drizzle), because the tool loads them before tsconfig paths apply.',
  why: 'A relative path breaks when a file moves and hides which module a file depends on. One alias per module keeps imports greppable.',
  how_to_fix:
    'Import through the configured @ alias (@api/*, @coworker/*, @/* in apps). If no alias covers the module, add a narrow alias to tsconfig.base.json.',
  applies_to: (file_path) => is_source_file(file_path) && !package_root_config_pattern.test(file_path),
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/sample.ts',
      source_text: "import a from './a';\nexport { b } from '../b';\nconst c = await import('./c');\ntype D = import('../d').D;\n",
      expected_count: 4,
    },
    {
      file_path: 'apps/api/src/sample.ts',
      source_text: "import a from '@api/a';\nimport { z } from 'zod';\nconst c = await import('@coworker/core');\n",
      expected_count: 0,
    },
    { file_path: 'apps/app/vite.config.ts', source_text: "import x from './x';\n", expected_count: 0 },
  ],
};
