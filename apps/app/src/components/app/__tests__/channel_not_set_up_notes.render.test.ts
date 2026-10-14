import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmailNotSetUpNote, SlackNotSetUpNote } from '@/components/app/channel_not_set_up_notes';

describe('a channel that this install has not set up', () => {
  it.each([
    [
      'email',
      EmailNotSetUpNote,
      './alfera add email',
      'Email is not set up on this install',
      'SELF_HOSTING.md#alfera-by-email',
    ],
    [
      'Slack',
      SlackNotSetUpNote,
      './alfera add slack',
      'Slack is not set up on this install',
      'SELF_HOSTING.md#alfera-inside-your-slack',
    ],
  ])('%s: says what it does, the one command, and links to its own part of the guide', (_name, note, command, title, guide_section) => {
    const html = renderToStaticMarkup(createElement(note));

    expect(html).toContain(title);
    expect(html).toContain(
      `<code class="rounded bg-muted px-1 py-0.5 text-foreground">${command}</code>`,
    );
    expect(html).toContain(`${guide_section}"`);
    expect(html).not.toContain('SELF_HOSTING.md#connect-your-apps');
    expect(html).toContain('needs');
    expect(html).not.toContain('text-destructive');
  });
});
