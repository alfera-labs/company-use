import { type ComponentProps, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  chat_markdown_class_name,
  chat_markdown_streamdown_class_name,
  chat_preview_markdown_class_name,
  chat_preview_streamdown_class_name,
} from '@/components/app/chat_message';
import { MessageContent } from '@/components/prompt-kit/message';

function render_preview_markdown(text: string) {
  const props: ComponentProps<typeof MessageContent> = {
    children: text,
    className: chat_preview_markdown_class_name,
    markdown: true,
    streamdownClassName: chat_preview_streamdown_class_name,
  };
  return renderToStaticMarkup(createElement(MessageContent, props));
}

describe('markdown in the chat preview', () => {
  it('renders a heading and a list as real elements, not raw syntax', () => {
    const html = render_preview_markdown('## Weekly report\n\n- Revenue is up\n- Costs are flat');

    expect(html).toContain('Weekly report');
    expect(html).toMatch(/<h2/u);
    expect(html).toMatch(/<ul/u);
    expect(html).toMatch(/<li/u);
    expect(html).not.toContain('## Weekly');
  });

  it('renders emphasis and links', () => {
    const html = render_preview_markdown(
      '**Revenue** is up. See [the sheet](https://example.com).',
    );

    // Streamdown renders bold as a marked span rather than a <strong> element.
    expect(html).toMatch(/data-streamdown="strong"/u);
    expect(html).toContain('Revenue');
    expect(html).toMatch(/<a[^>]+href="https:\/\/example\.com\/?"/u);
    expect(html).not.toContain('**Revenue**');
  });

  it('renders a table', () => {
    const html = render_preview_markdown('| Month | Spend |\n| --- | --- |\n| Jul | $412 |');

    expect(html).toMatch(/<table/u);
    expect(html).toContain('Spend');
  });

  it('renders a fenced code block', () => {
    const html = render_preview_markdown('```sql\nSELECT 1;\n```');

    expect(html).toContain('SELECT 1;');
    expect(html).not.toContain('```');
  });

  it('carries the preview size class so it is not rendered at transcript size', () => {
    const html = render_preview_markdown('hello');

    expect(html).toContain('text-[11px]');
  });
});

describe('the seeded onboarding opening', () => {
  it('renders its facts as a real list in the transcript', () => {
    const props: ComponentProps<typeof MessageContent> = {
      children: [
        'Hey Robin — I did my homework while you signed up.',
        '',
        '- Shopify store, 214 products',
        '- One abandoned-cart email',
        '',
        "Here's where I'd start. Pick one, or tell me what's eating your week.",
      ].join('\n'),
      className: chat_markdown_class_name,
      markdown: true,
      streamdownClassName: chat_markdown_streamdown_class_name,
    };
    const html = renderToStaticMarkup(createElement(MessageContent, props));

    expect(html).toMatch(/<ul[^>]+list-disc/u);
    expect(html).toContain('Shopify store, 214 products');
    expect(html).not.toContain('- Shopify');
  });
});
