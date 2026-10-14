import { readdirSync, readFileSync } from 'node:fs';
import { MakingServerScreen } from '@coworker/ui/components/company_use_deploy/making_server_screen';
import { OpenAwsLink } from '@coworker/ui/components/company_use_deploy/open_aws_link';
import { DeployLookContext } from '@coworker/ui/lib/company_use_deploy/deploy_look';
import { create_session } from '@coworker/ui/lib/company_use_deploy/deploy_session';
import { read_aws_link } from '@coworker/ui/lib/company_use_deploy/deploy_steps';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, test } from 'vitest';
import { app_deploy_look } from '@/components/deploy/deploy_look';

const template_url = 'https://templates.example.com/alfera-ec2.yaml';
const aws_session = create_session(
  { cloud: 'aws', name: 'acme', backups: false },
  { version: 'v1.2.3', api_origin: 'https://api.example.com', test_overrides: null },
);
const shared_folders = ['components', 'hooks', 'lib'].map(
  (kind) => new URL(`../../../../../packages/ui/src/${kind}/company_use_deploy/`, import.meta.url),
);

function link_of_the_session() {
  const link = read_aws_link(aws_session, template_url);
  assert.ok('href' in link);
  return link.href;
}

const render_with_the_look = (screen: ReactNode) =>
  renderToStaticMarkup(createElement(DeployLookContext, { value: app_deploy_look }, screen));

function sources_that_open_a_popup(folder: URL) {
  const sources = readdirSync(folder).filter(
    (file) => /\.tsx?$/.test(file) && !file.includes('.test.'),
  );
  return sources.filter((file) =>
    readFileSync(new URL(file, folder), 'utf8').includes('window.open'),
  );
}

describe('the Open AWS step', () => {
  test('is a link that opens the quick-create page in a new tab, with no popup script', () => {
    const href = link_of_the_session();
    assert.match(href, /^https:\/\/[a-z0-9-]+\.console\.aws\.amazon\.com\/cloudformation\//);
    const markup = render_with_the_look(
      createElement(OpenAwsLink, { href, label: 'Open AWS', kind: 'main', on_open: () => {} }),
    );
    assert.match(markup, /^<a href="https:\/\/[^"]+" target="_blank" rel="noopener"/);
    assert.include(markup, `class="${app_deploy_look.main_button}"`);
    assert.deepEqual(shared_folders.flatMap(sources_that_open_a_popup), []);
  });

  test('stays on the making screen as Open AWS again until the first report', () => {
    const making = { ...aws_session, phase: 'making' as const };
    const with_link = render_with_the_look(
      createElement(MakingServerScreen, {
        session: making,
        aws_link_again: link_of_the_session(),
        on_outcome: () => {},
      }),
    );
    assert.match(with_link, />Open AWS again<\/a>/);
    assert.match(with_link, /target="_blank" rel="noopener"/);
    const without_link = render_with_the_look(
      createElement(MakingServerScreen, {
        session: making,
        aws_link_again: null,
        on_outcome: () => {},
      }),
    );
    assert.notMatch(without_link, /Open AWS again/);
  });
});
