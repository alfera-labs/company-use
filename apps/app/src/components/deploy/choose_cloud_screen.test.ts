import { ChooseCloudScreen } from '@coworker/ui/components/company_use_deploy/choose_cloud_screen';
import { DeployLookContext } from '@coworker/ui/lib/company_use_deploy/deploy_look';
import { choose_words } from '@coworker/ui/lib/company_use_deploy/deploy_words';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, test } from 'vitest';
import { app_deploy_look } from '@/components/deploy/deploy_look';

const render_choose = (available: { digitalocean: boolean; aws: boolean }) =>
  renderToStaticMarkup(
    createElement(
      DeployLookContext,
      { value: app_deploy_look },
      createElement(ChooseCloudScreen, {
        initial: { cloud: 'aws', name: '', backups: false },
        available,
        on_start: async () => {},
      }),
    ),
  );

describe('the choose cloud screen', () => {
  test('says the page is not set up when no cloud is available', () => {
    const markup = render_choose({ digitalocean: false, aws: false });
    assert.include(markup, choose_words.none_available);
    assert.notInclude(markup, 'type="submit"');
  });

  test('lets the person pick an available cloud and press Start', () => {
    const markup = render_choose({ digitalocean: false, aws: true });
    const aws_radio = markup.match(/<input[^>]*value="aws"[^>]*>/)?.[0] ?? '';
    assert.include(aws_radio, 'checked=""');
    assert.notInclude(aws_radio, 'disabled');
    assert.match(markup, /<button type="submit"[^>]*>Start<\/button>/);
  });

  test('keeps its own corners when the app theme changes its radius', () => {
    const theme_radius = /\brounded-(?:sm|md|lg|xl|2xl|3xl|4xl)\b/;
    for (const [part, classes] of Object.entries(app_deploy_look)) {
      assert.notMatch(JSON.stringify(classes), theme_radius, part);
    }
  });
});
