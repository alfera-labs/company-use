import { readFileSync } from 'node:fs';
import { list_repository_files } from '@scripts/lib/list_repository_files';
import * as ts from 'typescript';

/*
 * Guard: no session-level `SET` in SQL we send to Postgres. Dev and prod connect through a
 * transaction-mode pooler, so a plain `SET` or `set_config(..., false)` stays on the shared server
 * connection and the next client inherits it (a leaked read-only setting fails its writes).
 * Scoped forms end with the transaction and are allowed: `SET LOCAL`, `SET TRANSACTION`,
 * `SET CONSTRAINTS`, `sql.begin('read only', …)`, `set_config(..., true)`.
 */

// Known violations, each with the reason it is not fixed here. Shrink this list; never grow it.
const accepted_session_settings: Record<string, string> = {
  'scripts/migrate.ts':
    'SET lock_timeout runs once per migrate process; it reaches the pooler via DATABASE_URL. ' +
    'Moving it (and the session advisory lock) to a direct connection is an open maintainer decision.',
};

type SessionSetFinding = { repository_path: string; line: number; statement: string };

const session_set_statement = /^SET\s+(?!LOCAL\b|TRANSACTION\b|CONSTRAINTS\b)/iu;
const session_set_config = /\bset_config\s*\([^)]*,\s*false\s*\)/iu;

export function is_sql_bearing_file(repository_path: string) {
  return (
    /^(apps|packages|scripts|infra)\/.+\.(tsx?|mts|cts|mjs|js|sql)$/u.test(repository_path) &&
    !/(\.test\.|\/__tests__\/|^scripts\/check-no-session-set-through-pooler\.ts$)/u.test(
      repository_path,
    )
  );
}

// SQL comments are dropped first so a commented-out statement or a note about `SET` is not flagged.
export function find_session_sets_in_sql(sql_text: string) {
  const without_comments = sql_text.replace(/--[^\n]*/gu, '').replace(/\/\*[\s\S]*?\*\//gu, '');
  const statements = without_comments.split(';').map((statement) => statement.trim());
  return statements.filter(
    (statement) => session_set_statement.test(statement) || session_set_config.test(statement),
  );
}

// In TS/JS, SQL lives in string and template literals. A lowercase `set` is only SQL inside a
// tagged template (sql`…`, client`…`); elsewhere it is English ("set the flag to …").
function list_sql_candidates(file_name: string, source: string) {
  const source_file = ts.createSourceFile(file_name, source, ts.ScriptTarget.Latest, true);
  const candidates: { position: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    const tagged = node.parent !== undefined && ts.isTaggedTemplateExpression(node.parent);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      candidates.push({
        position: node.getStart(),
        text: tagged ? node.text : upper_set_only(node.text),
      });
    } else if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(
        '$1',
      );
      candidates.push({ position: node.getStart(), text: tagged ? text : upper_set_only(text) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source_file);
  return candidates.map(({ position, text }) => ({
    line: source_file.getLineAndCharacterOfPosition(position).line + 1,
    text,
  }));
}

// Outside tagged templates only an uppercase `SET` counts, so blank out every other spelling.
function upper_set_only(text: string) {
  return text.replace(/\b(?!SET\b)[Ss][Ee][Tt]\b/gu, '___');
}

export function find_session_sets(repository_path: string, source: string): SessionSetFinding[] {
  if (repository_path.endsWith('.sql')) {
    return find_session_sets_in_sql(source).map((statement) => ({
      repository_path,
      line:
        source.split('\n').findIndex((line) => line.includes(statement.split('\n')[0] ?? '')) + 1,
      statement,
    }));
  }
  return list_sql_candidates(repository_path, source).flatMap(({ line, text }) =>
    find_session_sets_in_sql(text).map((statement) => ({ repository_path, line, statement })),
  );
}

function run_self_test() {
  const violations = [
    'await sql`SET default_transaction_read_only = on`;',
    "await client.unsafe('SET search_path TO app');",
    'await sql`set statement_timeout = 0`;',
    "await sql`SELECT set_config('app.workspace_id', ${id}, false)`;",
    "await sql`SELECT 1; SET role = 'reader'`;",
  ];
  for (const source of violations) {
    if (find_session_sets('planted.ts', source).length !== 1) {
      throw new Error(`self-test: session SET not caught in: ${source}`);
    }
  }
  const allowed = [
    "await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);",
    'await sql`SET TRANSACTION READ ONLY`;',
    "await sql`UPDATE runs\n  SET status = 'done'\n  WHERE id = ${id}`;",
    "await sql`SELECT set_config('app.workspace_id', ${id}, true)`;",
    "const hint = 'Set COWORKER_RUNTIME=e2b to enable it.';",
    "const copy = 'set the timer to run every day';",
    "await sql.begin('read only', async (tx) => tx`SELECT 1`);",
  ];
  for (const source of allowed) {
    const findings = find_session_sets('planted.ts', source);
    if (findings.length !== 0) throw new Error(`self-test: false positive in: ${source}`);
  }
  if (find_session_sets('planted.sql', 'UPDATE t\nSET a = 1;\nSET search_path = x;').length !== 1) {
    throw new Error('self-test: SQL file statements were not split correctly');
  }
  console.log('check-no-session-set-through-pooler self-test passed');
}

function run_check() {
  const findings = list_repository_files(is_sql_bearing_file).flatMap((repository_path) =>
    find_session_sets(repository_path, readFileSync(repository_path, 'utf8')),
  );
  const new_findings = findings.filter(
    ({ repository_path }) => !accepted_session_settings[repository_path],
  );
  for (const [repository_path, reason] of Object.entries(accepted_session_settings)) {
    if (!findings.some((finding) => finding.repository_path === repository_path)) {
      console.error(
        `${repository_path} no longer sets session state: delete its accepted exception.`,
      );
      process.exitCode = 1;
    }
    console.log(
      `check-no-session-set-through-pooler: accepted exception ${repository_path}: ${reason}`,
    );
  }
  if (new_findings.length === 0) {
    console.log('check-no-session-set-through-pooler: no session-level SET found');
    return;
  }
  console.error(
    'Session-level SET found. Through the pooler it leaks onto a shared connection and breaks\n' +
      "someone else's query. Use a transaction instead: sql.begin('read only', ...) for read-only\n" +
      'work, `SET LOCAL x = y` inside sql.begin(...) for a setting, set_config(..., true) for a GUC:',
  );
  for (const { repository_path, line, statement } of new_findings) {
    console.error(`  ${repository_path}:${line}: ${statement.split('\n')[0]}`);
  }
  process.exitCode = 1;
}

if (process.argv.includes('--self-test')) run_self_test();
else run_check();
