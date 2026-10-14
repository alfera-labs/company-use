import ts from 'typescript';
import type { RatchetRule, RatchetRuleInput, RatchetViolation } from '@scripts/ratchet/rule_types';
import { is_source_file_outside_tests } from '@scripts/ratchet/source_scope';
import { find_nodes, start_line_of } from '@scripts/ratchet/syntax_walk';

const route_method_names = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);
const versioned_path_prefixes = ['/v1/', '/internal/', '/health', '/api/compat/v1/', '/.well-known/'];

function read_top_level_constant(name: string, source_file: ts.SourceFile): ts.Expression | undefined {
  const declarations = source_file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations]);
  return declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)?.initializer;
}

function read_template_prefix(node: ts.TemplateExpression, source_file: ts.SourceFile): string | undefined {
  const first_span = node.templateSpans[0];
  if (node.head.text || !first_span) return node.head.text;
  return read_static_path(first_span.expression, source_file);
}

function read_static_path(node: ts.Expression, source_file: ts.SourceFile): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return read_static_path(node.expression, source_file);
  if (ts.isTemplateExpression(node)) return read_template_prefix(node, source_file);
  const constant = ts.isIdentifier(node) ? read_top_level_constant(node.text, source_file) : undefined;
  return constant ? read_static_path(constant, source_file) : undefined;
}

function read_route_path(call: ts.CallExpression, source_file: ts.SourceFile): string | undefined {
  const [path_argument] = call.arguments;
  if (!ts.isPropertyAccessExpression(call.expression) || !path_argument || call.arguments.length < 2) return undefined;
  if (!route_method_names.has(call.expression.name.text)) return undefined;
  const path = read_static_path(path_argument, source_file);
  return path?.startsWith('/') ? path : undefined;
}

function is_versioned(path: string): boolean {
  return path === '/v1' || versioned_path_prefixes.some((prefix) => path.startsWith(prefix));
}

function find_violations({ source_file }: RatchetRuleInput): RatchetViolation[] {
  return find_nodes(source_file, ts.isCallExpression).flatMap((call) => {
    const path = read_route_path(call, source_file);
    if (path === undefined || is_versioned(path)) return [];
    return [{ line: start_line_of(call.arguments[0] ?? call, source_file), message: `route "${path}" has no version prefix` }];
  });
}

export const versioned_routes_rule: RatchetRule = {
  rule_id: 'versioned-routes',
  summary:
    'Every Hono `.get/.post/.put/.patch/.delete/.all(path, handler)` in apps/api/src/** uses a path that starts with `/v1/`, `/internal/`, `/health`, `/api/compat/v1/`, or `/.well-known/` (RFC 8615 fixes those paths; their version lives in the standard). Every router mounts at `/` in app.ts, so the literal path is the public path. Test files are exempt.',
  why: 'An unversioned route cannot change without breaking the clients that call it. The version prefix lets the contract evolve.',
  how_to_fix:
    'Serve the route under `/v1/...`. If clients call the old path, keep it as a redirect to the new path for one release, then delete it.',
  applies_to: (file_path) => is_source_file_outside_tests(file_path) && file_path.startsWith('apps/api/src/'),
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text:
        "const base = '/public/templates';\nexport const r = new Hono()\n  .get('/public/apps/search', h)\n  .post('/v2/x', v, h)\n  .get(base, h)\n  .get(`${base}/:slug`, h);\n",
      expected_count: 4,
    },
    {
      file_path: 'apps/api/src/routes/sample.ts',
      source_text:
        "const one = '/v1/access/:id';\nexport const r = new Hono()\n  .get('/v1/sessions', h)\n  .get('/health', h)\n  .post('/internal/run-queued-jobs', h)\n  .post('/api/compat/v1/messages', h)\n  .put(`${one}/grantees`, h);\nconst v = map.get('/cache-key');\nurl.searchParams.get('x', y);\n",
      expected_count: 0,
    },
  ],
};
