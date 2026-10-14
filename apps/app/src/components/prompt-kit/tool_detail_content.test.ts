import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolDetailBody } from '@/components/prompt-kit/tool_detail_content';

describe('ToolDetailBody', () => {
  it('renders a multiline string field with real line breaks, never an escaped \\n', () => {
    const css = ':root {\n  --bg: #fff;\n}';
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        input: { file_content: css },
      }),
    );

    expect(html).toContain('<pre');
    expect(html).toContain('--bg: #fff;');
    expect(html).not.toContain('\\n');
  });

  it('renders short object fields as key-value lines', () => {
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        input: { path: '/repo/style.css', dry_run: false },
      }),
    );

    expect(html).toContain('>path<');
    expect(html).toContain('/repo/style.css');
    expect(html).toContain('>dry_run<');
    expect(html).toContain('false');
  });

  it('nests an object under its own branch instead of flattening it into a dot-path', () => {
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        input: { style: { root: '#fff', body: '#000' } },
      }),
    );

    expect(html).toContain('>style<');
    expect(html).toContain('>root<');
    expect(html).toContain('>body<');
  });

  it('never prints the tool call id — the card carries no footer', () => {
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        input: { path: '/repo/style.css' },
        output: { ok: true },
      }),
    );

    expect(html).toContain('Input');
    expect(html).toContain('Output');
    expect(html).not.toContain('tcall_');
  });

  it('shows a Copy word for the Input and Output sections, not an icon', () => {
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        input: { path: '/repo/style.css' },
        output: { ok: true },
      }),
    );

    expect(html.match(/>Copy</gu)).toHaveLength(2);
    expect(html).not.toContain('<svg');
  });

  it('shows the error text as its own section without a copy button', () => {
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        errorText: 'Permission denied.',
        input: { path: '/repo/style.css' },
      }),
    );

    expect(html).toContain('Error');
    expect(html).toContain('Permission denied.');
    expect(html.match(/>Copy</gu)).toHaveLength(1);
  });

  it('drops a content_text field that just restates content_json', () => {
    const content_json = { ok: true, count: 3 };
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        output: { content_json, content_text: JSON.stringify(content_json) },
      }),
    );

    expect(html).toContain('>content_json<');
    expect(html).not.toContain('content_text');
  });

  it('keeps content_text when it carries different information from content_json', () => {
    const html = renderToStaticMarkup(
      createElement(ToolDetailBody, {
        toolName: 'workspace-read_file-1',
        output: { content_json: { ok: true }, content_text: 'A human summary of the result.' },
      }),
    );

    expect(html).toContain('>content_json<');
    expect(html).toContain('>content_text<');
    expect(html).toContain('A human summary of the result.');
  });
});
