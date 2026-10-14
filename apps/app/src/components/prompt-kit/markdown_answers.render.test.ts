// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '@/components/prompt-kit/markdown';
import { workspace_file_download_url } from '@/lib/api';

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

function render_answer(markdown: string) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Markdown, null, markdown)));
  return {
    container,
    image_addresses: [...container.querySelectorAll('img')].map((image) => image.src),
    text: container.textContent ?? '',
  };
}

const chart_in_files = workspace_file_download_url('files/demo/chart.png');

describe('an image in an answer', () => {
  it.each([
    'files/demo/chart.png',
    './files/demo/chart.png',
    '/workspace/files/demo/chart.png',
    'sandbox:/workspace/files/demo/chart.png',
  ])('shows a file of the workspace named as %s', (written_address) => {
    const answer = render_answer(`Here is the chart.\n\n![chart.png](${written_address})`);

    expect(answer.image_addresses).toEqual([chart_in_files]);
    expect(answer.text).not.toContain('Image blocked');
  });

  it('reads the file through the address the Files panel reads', () => {
    const address = new URL(chart_in_files);

    expect(address.origin).toBe(window.location.origin);
    expect(address.pathname).toBe('/api/v1/workspace/files/download');
    expect(address.searchParams.get('file_path')).toBe('files/demo/chart.png');
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd.png',
    'data:text/html;base64,PHNjcmlwdD4=',
    'ftp-like-thing:chart.png',
  ])('still refuses %s', (written_address) => {
    const answer = render_answer(`![chart.png](${written_address})`);

    expect(answer.image_addresses).toEqual([]);
  });

  it.each([
    '../../etc/secret.png',
    'files/../../secret.png',
    'files/report.pdf',
  ])('never asks the files route to climb out of the workspace for %s', (written_address) => {
    const answer = render_answer(`![chart.png](${written_address})`);

    expect(decodeURIComponent(answer.image_addresses.join())).not.toContain('..');
    expect(answer.image_addresses.join()).not.toContain('.pdf');
  });
});

describe('lines in an answer', () => {
  it('keeps each single line break: one number per line stays one number per line', () => {
    const { container } = render_answer('1\n2\n3');

    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelectorAll('p br')).toHaveLength(2);
  });

  it('still reads a blank line as a new paragraph, a list as a list and code as code', () => {
    const { container } = render_answer('First.\n\nSecond.\n\n- a\n- b\n\n`x`');

    expect(container.querySelectorAll('p')).toHaveLength(3);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('br')).toHaveLength(0);
  });
});
