import { describe, expect, it } from 'vitest';
import { access_ended_page, join_confirm_page, link_not_valid_page } from '@/lib/team_pages';

describe('the page a sign-in link opens', () => {
  it('says "Join" to a person who has not joined yet', async () => {
    const page = join_confirm_page({
      workspace_name: 'Acme',
      person_name: 'Grace',
      has_joined_before: false,
    });
    const html = await page.text();

    expect(html).toContain('<h1>Join Acme</h1>');
    expect(html).toContain('<button type="submit">Join</button>');
  });

  it('says "Sign in to" to a member who is only signing in again', async () => {
    const page = join_confirm_page({
      workspace_name: 'Acme',
      person_name: 'Grace',
      has_joined_before: true,
    });
    const html = await page.text();

    expect(html).toContain('<title>Sign in to Acme</title>');
    expect(html).toContain('<h1>Sign in to Acme</h1>');
    expect(html).toContain('<button type="submit">Sign in</button>');
    expect(html).not.toContain('Join');
  });
});

describe('every plain page of a team install', () => {
  const pages = {
    'the page for a link that is not valid': link_not_valid_page,
    'the page a link opens': () =>
      join_confirm_page({ workspace_name: 'Acme', person_name: '', has_joined_before: true }),
    'the page for a removed person': () => access_ended_page('Acme'),
  };

  it.each(
    Object.entries(pages),
  )('%s carries the mark and the colours of the app', async (_, page) => {
    const html = await page().text();

    expect(html).toContain('aria-label="Alfera"');
    expect(html).toContain('--page: #fbfaf9');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it.each(Object.entries(pages))('%s loads nothing from anywhere', async (_, page) => {
    const response = page();
    const html = await response.text();

    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<link|<img|url\(/u);
  });
});

describe('the page for a person who was removed', () => {
  it('says that the access ended, to which workspace, and whom to ask', async () => {
    const page = access_ended_page('Acme & <Sons>');
    const html = await page.text();

    expect(page.status).toBe(403);
    expect(html).toContain('<h1>Your access to Acme &amp; &lt;Sons&gt; has ended</h1>');
    expect(html).toContain('ask the owner or an admin of the workspace');
    expect(html).not.toContain('needs a sign-in link');
  });

  it('still says it when the name of the workspace is not known', async () => {
    expect(await access_ended_page('').text()).toContain('Your access to this workspace has ended');
  });
});
