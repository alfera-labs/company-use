import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Guard: a shadcn component must not silently lose its Alfera styling.
 *
 * shadcn copies component source into this repo and expects us to own it, so `shadcn add
 * <name> --overwrite` is destructive BY DESIGN — it replaces the file with the registry's stock
 * version. Seventeen of our components carry Alfera-only classes (`field`, `row-interactive`,
 * `t-dropdown`) and Alfera-only tokens (`bg-raised`, `shadow-overlay`, `z-dropdown`). An
 * overwrite reverts them to plain shadcn: still compiles, still typechecks, still passes every
 * test, and the input quietly loses its surface. Nothing else in the repo notices.
 *
 * The vocabulary is NOT hardcoded here. It is read out of globals.css — every class defined in
 * its `@layer` blocks, plus every utility root its `@theme` block adds. Add a token there and
 * this guard starts protecting it with no edit to this file.
 *
 * The baseline is shrink-only: gaining markers is fine and needs no action, losing them fails.
 * Run with `--update` after a deliberate change, and commit the baseline with it.
 */

const repository_root = process.cwd();
const globals_stylesheet = join(repository_root, 'packages/ui/src/styles/globals.css');
const components_directory = join(repository_root, 'packages/ui/src/components');
const baseline_path = join(repository_root, 'packages/ui/alfera-styling.baseline.json');

// Tailwind emits one utility root per `@theme` key; these are the prefixes that can carry it.
const utility_prefixes = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'shadow', 'ease'];

// `.dark` is the theme class, not a component style. It appears in globals.css as a selector and
// in components as the `dark:` variant, so counting it would mark a file as "styled by Alfera"
// on the strength of one stock shadcn dark-mode rule — the exact false pass this guard exists to
// prevent.
const framework_classes = new Set(['dark', 'marketing']);

export function find_alfera_markers(globals_css: string): Set<string> {
  const markers = new Set<string>();

  // Classes we define ourselves: `.panel`, `.field`, `.row-interactive`, `.t-dropdown`.
  // Matched after any of start-of-line, `{`, `,` or whitespace rather than only at line start,
  // so a selector list or a one-line rule is still seen.
  for (const match of globals_css.matchAll(/(?:^|[\s,{])\.([a-z][a-z0-9-]*)(?=[\s,{:[])/gmu)) {
    const name = match[1] as string;
    if (!framework_classes.has(name)) markers.add(name);
  }

  // Utility roots our `@theme` block adds. Only globals.css is read, never shadcn.css, so
  // shadcn's own names (`bg-primary`, `text-muted-foreground`) are deliberately NOT markers —
  // a stock component uses those too, and they would make every check pass by accident.
  // `[^}]*` rather than a lazy `[\s\S]*?\n\}`: the block has no nested braces, and requiring the
  // closing brace on its own line makes the matcher depend on formatting.
  const theme_block = globals_css.match(/@theme inline\s*\{([^}]*)\}/u)?.[1] ?? '';
  for (const match of theme_block.matchAll(/--(color|shadow|ease)-([a-z0-9-]+)\s*:/gu)) {
    const root = match[2] as string;
    if (match[1] === 'color') {
      for (const prefix of utility_prefixes) markers.add(`${prefix}-${root}`);
    } else {
      markers.add(`${match[1]}-${root}`);
    }
  }
  return markers;
}

// Whole-word match so `bg-page` does not also count `bg-page-header`, and so a marker inside a
// longer arbitrary value is not mistaken for the utility.
export function find_markers_used(source: string, markers: Set<string>): string[] {
  const used = new Set<string>();
  for (const token of source.matchAll(/[a-z][a-z0-9-]*/gu)) {
    const word = token[0];
    if (markers.has(word)) used.add(word);
  }
  return [...used].sort();
}

type Baseline = Record<string, string[]>;

async function build_current_markers(): Promise<Baseline> {
  const globals_css = await readFile(globals_stylesheet, 'utf8');
  const markers = find_alfera_markers(globals_css);
  const files = (await readdir(components_directory)).filter((name) => name.endsWith('.tsx'));
  const current: Baseline = {};
  for (const name of files.sort()) {
    const source = await readFile(join(components_directory, name), 'utf8');
    const used = find_markers_used(source, markers);
    if (used.length > 0) current[name] = used;
  }
  return current;
}

export function find_lost_markers(baseline: Baseline, current: Baseline) {
  const losses: { component: string; lost: string[] }[] = [];
  for (const [component, expected] of Object.entries(baseline)) {
    const used = new Set(current[component] ?? []);
    const lost = expected.filter((marker) => !used.has(marker));
    if (lost.length > 0) losses.push({ component, lost });
  }
  return losses;
}

async function run_self_test() {
  const markers = find_alfera_markers(`
    @theme inline { --color-raised: var(--x); --shadow-overlay: var(--y); }
    @layer components { .row-interactive { color: red; } }
    .t-dropdown { opacity: 1; }
  `);
  for (const expected of ['bg-raised', 'text-raised', 'shadow-overlay', 'row-interactive', 't-dropdown']) {
    if (!markers.has(expected)) throw new Error(`self-test: marker ${expected} not detected`);
  }
  // shadcn's own names must never become markers, or a stock component passes by accident.
  if (markers.has('bg-primary')) throw new Error('self-test: shadcn name leaked into markers');
  // Nor may the theme class, which every dark-mode-aware stock component mentions.
  if (find_alfera_markers('.dark { --x: 1; }').has('dark')) {
    throw new Error('self-test: the dark theme class was counted as Alfera styling');
  }

  const used = find_markers_used('className="row-interactive bg-raised px-2"', markers);
  if (used.join(',') !== 'bg-raised,row-interactive') {
    throw new Error(`self-test: wrong markers found: ${used.join(',')}`);
  }
  // A longer token that merely contains a marker is not that marker.
  if (find_markers_used('bg-raised-extra', markers).length > 0) {
    throw new Error('self-test: partial word matched');
  }

  const losses = find_lost_markers(
    { 'input.tsx': ['field', 'bg-raised'] },
    { 'input.tsx': ['bg-raised'] },
  );
  if (losses.length !== 1 || losses[0]?.lost.join(',') !== 'field') {
    throw new Error('self-test: a lost marker was not reported');
  }
  if (find_lost_markers({ 'a.tsx': ['field'] }, { 'a.tsx': ['field', 'well'] }).length !== 0) {
    throw new Error('self-test: gaining a marker should not fail');
  }
  console.log('check-ui-keeps-alfera-styling self-test passed');
}

if (process.argv.includes('--self-test')) {
  await run_self_test();
} else if (process.argv.includes('--update')) {
  const current = await build_current_markers();
  await writeFile(baseline_path, `${JSON.stringify(current, null, 2)}\n`);
  const count = Object.keys(current).length;
  console.log(`check-ui-keeps-alfera-styling: baseline written for ${count} components`);
} else {
  const baseline = JSON.parse(await readFile(baseline_path, 'utf8')) as Baseline;
  const losses = find_lost_markers(baseline, await build_current_markers());
  if (losses.length > 0) {
    console.error(
      'These components lost Alfera styling. The usual cause is `shadcn add <name> --overwrite`,\n' +
        'which replaces the file with the registry’s stock version and drops our classes.\n' +
        'Re-apply the styling, or run `bun run lint:ui-styling:update` if the removal was deliberate:',
    );
    for (const { component, lost } of losses) {
      console.error(`  ${component} lost: ${lost.join(', ')}`);
    }
    process.exitCode = 1;
  } else {
    const count = Object.keys(baseline).length;
    console.log(`check-ui-keeps-alfera-styling: ${count} components keep their Alfera styling`);
  }
}
