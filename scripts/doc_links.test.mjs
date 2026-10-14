import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  check_doc_links,
  github_anchor,
  read_headings,
  read_repository_name,
} from './doc_links.mjs';

const repository_name = 'example-labs/example';
const guide_file = 'GUIDE.md';

function write_repository(files) {
  const root = mkdtempSync(join(tmpdir(), 'doc-links-'));
  const with_installer = {
    'deploy/install.sh': `readonly repository_url="\${PRODUCT_REPOSITORY:-https://github.com/${repository_name}.git}"\n`,
    ...files,
  };
  for (const [path, text] of Object.entries(with_installer)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function broken_links_of(files) {
  return check_doc_links(write_repository(files))
    .filter((link) => link.problem)
    .map((link) => `${link.file}:${link.line} ${link.problem}`);
}

const guide = [
  '# Guide',
  '## Connect your apps',
  '### An MCP server on this machine or on your own network',
  '## What is `off` by default?',
  '```bash',
  '# Not a heading',
  '```',
  '## Twice',
  '## Twice',
].join('\n');

test('a heading gets the anchor GitHub renders it with', () => {
  assert.equal(github_anchor('Connect your apps'), 'connect-your-apps');
  assert.equal(github_anchor('What is `off` by default?'), 'what-is-off-by-default');
  assert.equal(github_anchor('Sign-in and your team'), 'sign-in-and-your-team');
  assert.equal(github_anchor('Use it (from your own code)'), 'use-it-from-your-own-code');
  assert.deepEqual(
    read_headings(guide).map((heading) => heading.anchor),
    [
      'guide',
      'connect-your-apps',
      'an-mcp-server-on-this-machine-or-on-your-own-network',
      'what-is-off-by-default',
      'twice',
      'twice-1',
    ],
  );
});

test('the repository name comes from the one line of the installer that holds it', () => {
  assert.equal(read_repository_name(write_repository({})), repository_name);
});

test('links that lead somewhere pass, in markdown, in code and in words', () => {
  const guide_address = `https://github.com/${repository_name}/blob/main/GUIDE.md`;
  assert.deepEqual(
    broken_links_of({
      'GUIDE.md': `${guide}\n\nSee [twice](#twice-1) and [the readme](README.md).`,
      'README.md': '# Readme\n\n[Apps](GUIDE.md#connect-your-apps), [mail](mailto:a@example.com)',
      'notes/more.md': '[Up](../GUIDE.md#guide) and [out](https://example.com/GUIDE.md#nowhere)',
      'src/links.ts': `export const url = '${guide_address}#connect-your-apps';`,
      'deploy/helper': `echo '${guide_file}, "Connect your apps", says how.'\n# See "Twice" in ${guide_file}\ncurl https://raw.githubusercontent.com/${repository_name}/main/deploy/install.sh`,
    }),
    [],
  );
});

test('a link to a missing file or a missing heading is named with its file and line', () => {
  const guide_address = `https://github.com/${repository_name}/blob/main/GUIDE.md`;
  assert.deepEqual(
    broken_links_of({
      'GUIDE.md': `${guide}\n\n[Gone](#not-a-heading)`,
      'README.md': '# Readme\n\n[Apps](GUIDE.md#connect-your-app)\n[Lost](LOST.md)',
      'src/links.ts': `export const url = '${guide_address}#channels';`,
      'deploy/helper': `echo '${guide_file}, "Connect an app", says how.'\ncurl https://raw.githubusercontent.com/${repository_name}/main/deploy/gone.sh`,
    }).sort(),
    [
      'GUIDE.md:11 GUIDE.md has no heading with the anchor #not-a-heading',
      'README.md:3 GUIDE.md has no heading with the anchor #connect-your-app',
      'README.md:4 LOST.md is not in the repository',
      'deploy/helper:1 GUIDE.md has no heading "Connect an app"',
      'deploy/helper:2 deploy/gone.sh is not in the repository',
      'src/links.ts:1 GUIDE.md has no heading with the anchor #channels',
    ],
  );
});

test('an address that still holds an old name of the repository is named', () => {
  const old_name = `${repository_name.split('/')[0]}/old-name`;
  assert.deepEqual(
    broken_links_of({
      'README.md': `git clone https://github.com/${old_name}.git\ngit clone https://github.com/${repository_name}.git`,
      'src/links.ts': `export const url = 'https://github.com/${old_name}/blob/main/README.md';`,
    }).sort(),
    [
      `README.md:1 this repository is ${repository_name}, and the address names another one`,
      `src/links.ts:1 this repository is ${repository_name}, and the address names another one`,
    ],
  );
});

test('every link of this repository to one of its own files leads somewhere', () => {
  const links = check_doc_links();
  assert.ok(links.length > 10, `only ${links.length} links were found`);
  assert.deepEqual(
    links.filter((link) => link.problem).map((link) => `${link.file}:${link.line} ${link.problem}`),
    [],
  );
});
