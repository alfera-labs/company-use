import { createContext, useContext } from 'react';

const open_workspace_file_context = createContext<((file_path: string) => void) | null>(null);

export const OpenWorkspaceFileProvider = open_workspace_file_context.Provider;

export function useOpenWorkspaceFile() {
  return useContext(open_workspace_file_context);
}

const file_name_pattern = /\.[a-z0-9]{1,8}$/iu;
const url_scheme_pattern = /^[a-z][a-z0-9+.-]*:/iu;

/**
 * The workspace-relative path an href names, or null when the href is not a workspace file.
 * Paths are workspace-root-relative with no leading slash, exactly as the Files panel lists
 * them (`files/report.md`), so `files/` is a real folder and stays on the path.
 */
export function workspace_file_path_from_href(href: string): string | null {
  const without_fragment = href.split(/[?#]/u)[0]?.trim() ?? '';
  if (without_fragment === '') return null;
  // `sandbox:` is not a real URL scheme the browser can open — it is the convention some models
  // carry from their training for "a file in my own workspace", written as
  // `sandbox:/workspace/files/report.pdf`. That is exactly what this resolver opens, so strip the
  // prefix and treat the rest as a workspace path rather than letting it dead-end as a blocked link.
  const sandbox_stripped = without_fragment.replace(/^sandbox:(\/\/)?/iu, '');
  if (url_scheme_pattern.test(sandbox_stripped)) return null;
  if (sandbox_stripped.startsWith('//')) return null;

  const path = decode_path(sandbox_stripped)
    .replace(/^\.\//u, '')
    .replace(/^\/?workspace\//u, '')
    .replace(/^\/+/u, '');
  if (path === '' || path.startsWith('../') || path.includes('/../')) return null;
  if (!file_name_pattern.test(path.split('/').pop() ?? '')) return null;
  return path;
}

function decode_path(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// Some models write a workspace file link with a `sandbox:` scheme (`sandbox:/workspace/files/x.pdf`),
// a habit from their training. Streamdown's markdown sanitizer keeps only http/https/mailto/tel
// hrefs, so it drops the whole `sandbox:` URL and renders the link as a dead "[blocked]" span
// before `workspace_file_path_from_href` ever runs. Rewriting the scheme to a single leading slash
// leaves a root-relative path the sanitizer keeps and the resolver above opens. Only the inline
// link form `](sandbox:…)` is touched, so prose that mentions the word is left alone.
const sandbox_link_pattern = /\]\(\s*sandbox:\/*/gu;

export function rewrite_sandbox_file_links(markdown: string): string {
  return markdown.replace(sandbox_link_pattern, '](/');
}
