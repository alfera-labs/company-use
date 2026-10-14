import { describe, expect, it } from 'vitest';
import {
  rewrite_sandbox_file_links,
  workspace_file_path_from_href,
} from '@/components/prompt-kit/markdown_file_links';

function href_of(markdown: string): string {
  return markdown.match(/\]\(([^)]*)\)/u)?.[1] ?? '';
}

describe('rewrite_sandbox_file_links', () => {
  it('collapses a sandbox scheme to one root-relative slash, never a protocol-relative //', () => {
    expect(rewrite_sandbox_file_links('[x](sandbox:/workspace/files/report.pdf)')).toBe(
      '[x](/workspace/files/report.pdf)',
    );
    expect(rewrite_sandbox_file_links('[x](sandbox://files/report.pdf)')).toBe(
      '[x](/files/report.pdf)',
    );
  });

  it('leaves prose and real links untouched', () => {
    expect(rewrite_sandbox_file_links('the sandbox: prefix is a model habit')).toBe(
      'the sandbox: prefix is a model habit',
    );
    expect(rewrite_sandbox_file_links('[site](https://alfera.ai)')).toBe(
      '[site](https://alfera.ai)',
    );
  });

  it("rewrites Jordan's sandbox PDF link into a path the resolver opens (the whole chain)", () => {
    const rewritten = rewrite_sandbox_file_links(
      '[Download](sandbox:/workspace/files/harbor-analysis.pdf)',
    );
    const href = href_of(rewritten);
    expect(href.startsWith('//')).toBe(false);
    expect(workspace_file_path_from_href(href)).toBe('files/harbor-analysis.pdf');
  });
});

describe('workspace_file_path_from_href', () => {
  it('reads the workspace path a relative file link names', () => {
    expect(workspace_file_path_from_href('files/report.md')).toBe('files/report.md');
    expect(workspace_file_path_from_href('./files/report.md')).toBe('files/report.md');
    expect(workspace_file_path_from_href('/files/report.md')).toBe('files/report.md');
    expect(workspace_file_path_from_href('tasks/2026-09-03.md')).toBe('tasks/2026-09-03.md');
    expect(workspace_file_path_from_href('user.md')).toBe('user.md');
  });

  it('keeps the files/ folder on the path, because that is a real workspace folder', () => {
    expect(workspace_file_path_from_href('files/q3.xlsx')).toBe('files/q3.xlsx');
  });

  it('resolves the model root and percent-encoded names to what the Files panel lists', () => {
    expect(workspace_file_path_from_href('/workspace/files/report.md')).toBe('files/report.md');
    expect(workspace_file_path_from_href('files/quarterly%20report.md')).toBe(
      'files/quarterly report.md',
    );
  });

  it('drops the query and fragment a link may carry', () => {
    expect(workspace_file_path_from_href('files/report.md#summary')).toBe('files/report.md');
    expect(workspace_file_path_from_href('files/report.md?v=2')).toBe('files/report.md');
  });

  it('leaves addressable links alone', () => {
    expect(workspace_file_path_from_href('https://alfera.ai/report.md')).toBeNull();
    expect(workspace_file_path_from_href('http://localhost:3000/files/report.md')).toBeNull();
    expect(workspace_file_path_from_href('mailto:hi@example.com')).toBeNull();
    expect(workspace_file_path_from_href('data:text/plain,hello')).toBeNull();
    expect(workspace_file_path_from_href('//cdn.example.com/report.md')).toBeNull();
  });

  it('leaves anchors, routes and escapes alone', () => {
    expect(workspace_file_path_from_href('#summary')).toBeNull();
    expect(workspace_file_path_from_href('/chats/session_123')).toBeNull();
    expect(workspace_file_path_from_href('../../etc/passwd')).toBeNull();
    expect(workspace_file_path_from_href('files/../../secrets.md')).toBeNull();
    expect(workspace_file_path_from_href('')).toBeNull();
    expect(workspace_file_path_from_href('   ')).toBeNull();
  });

  it('needs a file name, not a word with a dot in it', () => {
    expect(workspace_file_path_from_href('files/archive')).toBeNull();
    expect(workspace_file_path_from_href('alfera.inc/about')).toBeNull();
  });

  it('opens the sandbox: file convention some models write', () => {
    expect(workspace_file_path_from_href('sandbox:/workspace/files/report.pdf')).toBe(
      'files/report.pdf',
    );
    expect(workspace_file_path_from_href('sandbox:/mnt/data/q3.xlsx')).toBe('mnt/data/q3.xlsx');
    expect(workspace_file_path_from_href('sandbox://files/report.pdf')).toBe('files/report.pdf');
    expect(workspace_file_path_from_href('sandbox:https://alfera.ai/x.pdf')).toBeNull();
    expect(workspace_file_path_from_href('sandbox:/workspace/files/archive')).toBeNull();
  });
});
