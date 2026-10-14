import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Guard: the Alfera theme must override every variable shadcn sets for dark mode.
 *
 * packages/ui/src/styles/shadcn.css is CLI output. It ships a placeholder palette in a `.dark`
 * block. Our palette lives in globals.css, and a plain `:root` rule there loses to that
 * `.dark` on specificity — so any token we set only under `:root` silently keeps shadcn's gray
 * after dark. That failure is invisible in light mode and easy to reintroduce the next time
 * `shadcn add` writes a new variable into the base file.
 *
 * The rule this enforces: for every `--name` in shadcn.css's `.dark` block, globals.css
 * must set the same `--name` under a selector that also matches a dark root — either its own
 * `.dark` block or the shared `:root, .dark` block. Both are later in the cascade at equal
 * specificity, so both win.
 */

const repository_root = process.cwd();
const shadcn_stylesheet = join(repository_root, 'packages/ui/src/styles/shadcn.css');
const theme_stylesheet = join(repository_root, 'packages/ui/src/styles/globals.css');

type StyleRule = { selectors: string[]; body: string };

// Splits the sheet into flat `selector { body }` rules. Comments go first so a commented-out
// declaration cannot count as coverage. Nesting is not a concern here: both files declare
// variables at the top level only, and an at-rule body never opens with a selector list.
function parse_rules(stylesheet: string): StyleRule[] {
  const without_comments = stylesheet.replace(/\/\*[\s\S]*?\*\//gu, '');
  // No `(^|\})` prefix: a global regex resumes after the previous match, so consuming the
  // closing brace would make every second rule invisible. Whatever precedes a `{` is the
  // selector list, and the filters below drop anything that is not a root selector.
  return [...without_comments.matchAll(/([^{}@]+)\{([^{}]*)\}/gu)].map((match) => ({
    selectors: (match[1] as string).split(',').map((part) => part.trim()).filter(Boolean),
    body: match[2] as string,
  }));
}

function find_declared_variables(rules: StyleRule[], matches_dark_root: boolean): string[] {
  return rules
    .filter((rule) =>
      matches_dark_root
        ? rule.selectors.includes('.dark')
        : rule.selectors.length === 1 && rule.selectors[0] === '.dark',
    )
    .flatMap((rule) => [...rule.body.matchAll(/(--[a-z0-9-]+)\s*:/gimu)].map((m) => m[1] as string));
}

function find_variables_missing_from_dark(shadcn_css: string, theme_css: string): string[] {
  // What shadcn sets for dark: rules whose selector list is exactly `.dark`.
  const shadcn_dark = find_declared_variables(parse_rules(shadcn_css), false);
  // What we cover: any rule that names `.dark`, alone or in a list such as `:root, .dark`.
  const covered = new Set(find_declared_variables(parse_rules(theme_css), true));
  return [...new Set(shadcn_dark.filter((name) => !covered.has(name)))].sort();
}

async function run_self_test() {
  const covered_by_shared = find_variables_missing_from_dark(
    '.dark { --primary: red; --border: blue; }',
    ':root, .dark { --primary: orange; }\n.dark { --border: green; }',
  );
  if (covered_by_shared.length > 0) {
    throw new Error(`self-test: expected full coverage, got ${covered_by_shared.join(', ')}`);
  }
  const light_only = find_variables_missing_from_dark(
    '.dark { --primary: red; }',
    ':root { --primary: orange; }',
  );
  if (light_only.join(',') !== '--primary') {
    throw new Error(`self-test: expected --primary uncovered, got ${light_only.join(', ') || 'none'}`);
  }
  console.log('check-theme-covers-shadcn-dark self-test passed');
}

if (process.argv.includes('--self-test')) {
  await run_self_test();
} else {
  const missing = find_variables_missing_from_dark(
    await readFile(shadcn_stylesheet, 'utf8'),
    await readFile(theme_stylesheet, 'utf8'),
  );
  if (missing.length > 0) {
    console.error(
      'These variables keep shadcn’s placeholder value in dark mode. Set each one in ' +
        'packages/ui/src/styles/globals.css, under `.dark` if it differs by theme or ' +
        'under `:root, .dark` if it does not:',
    );
    console.error(missing.map((name) => `  ${name}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('check-theme-covers-shadcn-dark: all shadcn dark variables are themed');
  }
}
