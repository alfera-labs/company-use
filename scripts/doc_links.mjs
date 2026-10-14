import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository_root = resolve(import.meta.dirname, '..');
const folders_never_read = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', '.output']);
const largest_file_read_in_bytes = 1_000_000;

/**
 * The `owner/name` of this repository on GitHub. The installer holds the one copy of it, in
 * the line that sets `repository_url`, so a rename there is a rename here.
 */
export function read_repository_name(root = repository_root) {
  const installer = readFileSync(join(root, 'deploy/install.sh'), 'utf8');
  const found = installer.match(/repository_url="[^"]*github\.com\/([\w.-]+\/[\w.-]+?)\.git/);
  if (!found) throw new Error('deploy/install.sh names no repository_url on github.com');
  return found[1];
}

/** The anchor GitHub gives a heading: small letters, no punctuation, a hyphen for each space. */
export function github_anchor(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
    .replaceAll(' ', '-');
}

function blank_the_code_blocks(markdown) {
  let inside = false;
  return markdown.split('\n').map((line) => {
    const is_fence = /^\s*(```|~~~)/.test(line);
    if (is_fence) inside = !inside;
    return inside || is_fence ? '' : line;
  });
}

/** Every heading of a markdown text, and the anchor GitHub renders it with. */
export function read_headings(markdown) {
  const times_seen = new Map();
  const headings = [];
  for (const line of blank_the_code_blocks(markdown)) {
    const found = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!found) continue;
    const base = github_anchor(found[1]);
    const seen = times_seen.get(base) ?? 0;
    times_seen.set(base, seen + 1);
    headings.push({ text: found[1], anchor: seen === 0 ? base : `${base}-${seen}` });
  }
  return headings;
}

function read_anchors(markdown) {
  const named = [...markdown.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)].map((found) => found[1]);
  return new Set([...read_headings(markdown).map((heading) => heading.anchor), ...named]);
}

function list_files(folder, root = folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return folders_never_read.has(entry.name) ? [] : list_files(path, root);
    if (!entry.isFile() || statSync(path).size > largest_file_read_in_bytes) return [];
    return [relative(root, path)];
  });
}

function links_of_a_markdown_file(file, text) {
  const links = [];
  blank_the_code_blocks(text).forEach((line, index) => {
    const inline = line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g);
    const defined = line.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/g);
    for (const found of [...inline, ...defined]) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(found[1])) continue;
      const [path, anchor] = found[1].split('#');
      const target = path ? join(dirname(file), path) : file;
      links.push({ file, line: index + 1, target, anchor: anchor ?? null, written: found[1] });
    }
  });
  return links;
}

function links_to_this_repository(file, text, repository_name) {
  const name = repository_name.replaceAll('.', '\\.');
  const address = new RegExp(
    `https://(?:github\\.com/${name}/(?:blob|tree)/[\\w.-]+|raw\\.githubusercontent\\.com/${name}/[\\w.-]+)/([\\w./-]*[\\w/-])(?:#([\\w-]+))?`,
    'g',
  );
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(address)].map((found) => ({
      file,
      line: index + 1,
      target: found[1],
      anchor: found[2] ?? null,
      written: found[0],
    })),
  );
}

function addresses_with_an_old_repository_name(file, text, repository_name) {
  const [owner, name] = repository_name.split('/');
  const address = new RegExp(
    `https://(?:github|raw\\.githubusercontent)\\.com/${owner.replaceAll('.', '\\.')}/([\\w.-]+)`,
    'g',
  );
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(address)]
      .filter((found) => found[1].replace(/\.git$/, '') !== name)
      .map((found) => ({
        file,
        line: index + 1,
        target: found[0],
        anchor: null,
        written: found[0],
        problem: `this repository is ${repository_name}, and the address names another one`,
      })),
  );
}

function sections_named_in_words(file, text) {
  const file_then_heading = /([\w/-]+\.md), "([^"]+)"/g;
  const heading_then_file = /"([^"]+)" in ([\w/-]+\.md)/g;
  return text.split('\n').flatMap((line, index) => [
    ...[...line.matchAll(file_then_heading)].map((found) => [found[1], found[2], found[0]]),
    ...[...line.matchAll(heading_then_file)].map((found) => [found[2], found[1], found[0]]),
  ].map(([target, heading, written]) => ({ file, line: index + 1, target, heading, written })));
}

/**
 * Every link of the repository to one of its own files: where it is, and what it points at.
 * An address at the same owner with another repository name is one too, and it is broken: it
 * is what a rename of the repository leaves behind.
 */
export function find_doc_links(root = repository_root) {
  const repository_name = read_repository_name(root);
  return list_files(root).flatMap((file) => {
    const text = readFileSync(join(root, file), 'utf8');
    if (text.includes('\u0000')) return [];
    return [
      ...(file.endsWith('.md') ? links_of_a_markdown_file(file, text) : []),
      ...links_to_this_repository(file, text, repository_name),
      ...addresses_with_an_old_repository_name(file, text, repository_name),
      ...sections_named_in_words(file, text),
    ];
  });
}

function problem_of_a_link(link, root, anchors_of) {
  if (!existsSync(join(root, link.target))) return `${link.target} is not in the repository`;
  if (link.heading) {
    const texts = read_headings(readFileSync(join(root, link.target), 'utf8')).map(
      (heading) => github_anchor(heading.text),
    );
    return texts.includes(github_anchor(link.heading))
      ? null
      : `${link.target} has no heading "${link.heading}"`;
  }
  if (!link.anchor || !link.target.endsWith('.md')) return null;
  return anchors_of(link.target).has(link.anchor)
    ? null
    : `${link.target} has no heading with the anchor #${link.anchor}`;
}

/** Checks every link of `find_doc_links`. A link with a problem says which file or heading is missing. */
export function check_doc_links(root = repository_root) {
  const anchors_by_file = new Map();
  const anchors_of = (file) => {
    if (!anchors_by_file.has(file)) {
      anchors_by_file.set(file, read_anchors(readFileSync(join(root, file), 'utf8')));
    }
    return anchors_by_file.get(file);
  };
  return find_doc_links(root).map((link) => ({
    ...link,
    problem: link.problem ?? problem_of_a_link(link, root, anchors_of),
  }));
}

function print_and_count_problems(links, lists_every_link) {
  for (const link of links) {
    if (!link.problem && !lists_every_link) continue;
    const points_at = link.heading
      ? `${link.target} "${link.heading}"`
      : `${link.target}${link.anchor ? `#${link.anchor}` : ''}`;
    console.log(
      `${link.problem ? 'BROKEN' : 'ok    '}  ${link.file}:${link.line}  ->  ${points_at}${link.problem ? `  (${link.problem})` : ''}`,
    );
  }
  return links.filter((link) => link.problem).length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const links = check_doc_links();
  const broken = print_and_count_problems(links, process.argv.includes('--list'));
  console.log(`${links.length} links to files of this repository, ${broken} broken.`);
  process.exit(broken === 0 ? 0 : 1);
}
