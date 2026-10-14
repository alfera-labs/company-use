import { useQuery } from '@tanstack/react-query';
import { Children, type ReactNode } from 'react';
import {
  useOpenWorkspaceFile,
  workspace_file_path_from_href,
} from '@/components/prompt-kit/markdown_file_links';
import { get_current_workspace, list_workspace_files } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export const markdown_link_class_name =
  'font-medium text-brand-ink underline-offset-4 hover:underline';

const path_in_text_pattern =
  /(?<![\w/.:@~-])(?:\.?\/)?(?:[\w.-]+\/)*[\w-][\w.-]*\.[a-z][a-z0-9]{0,7}(?![\w/-])/giu;

/**
 * True when the Files panel lists a file at this workspace path. It asks for the folder, not
 * for the file, and shares the answer with the Files panel: many paths in one folder make one
 * request. It reads the workspace the chat already loaded and asks for nothing without it.
 *
 * An answer is reused for 5 seconds, so a path in an answer that is still being
 * written does not ask again on each new word.
 */
export function useWorkspaceFileIsListed(file_path: string) {
  const workspace = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
    enabled: false,
  });
  const workspace_id = workspace.data?.workspace_id;
  const last_slash = file_path.lastIndexOf('/');
  const folder_path = file_path.slice(0, Math.max(last_slash, 0));
  const folder = useQuery({
    queryKey: query_keys.workspace_files(workspace_id ?? '', folder_path),
    queryFn: () => list_workspace_files(folder_path),
    enabled: Boolean(workspace_id),
    staleTime: 5000,
    retry: false,
  });
  const file_name = file_path.slice(last_slash + 1);
  return folder.data?.files.some((file) => file.file_name === file_name) ?? false;
}

/** Text that names a workspace file. It opens the file when the file exists, and is plain text when it does not. */
export function WorkspaceFilePathText({
  file_path,
  children,
}: {
  file_path: string;
  children: ReactNode;
}) {
  const open_workspace_file = useOpenWorkspaceFile();
  const is_listed = useWorkspaceFileIsListed(file_path);
  if (!open_workspace_file || !is_listed) return children;
  return (
    <button
      className={markdown_link_class_name}
      type="button"
      onClick={() => open_workspace_file(file_path)}
    >
      {children}
    </button>
  );
}

/** The same children, with each workspace file path in the plain text made openable. */
export function TextWithWorkspaceFilePaths({ children }: { children: ReactNode }) {
  const open_workspace_file = useOpenWorkspaceFile();
  if (!open_workspace_file) return children;
  return Children.map(children, (child) =>
    typeof child === 'string' ? link_file_paths_in_text(child) : child,
  );
}

/** Inline code. When the code is a workspace file path, it opens the file. */
export function CodeWithWorkspaceFilePath({ children }: { children: ReactNode }) {
  const open_workspace_file = useOpenWorkspaceFile();
  const code = Children.toArray(children);
  const file_path =
    open_workspace_file && code.length === 1 && typeof code[0] === 'string'
      ? workspace_file_path_from_href(code[0])
      : null;
  if (!file_path) return children;
  return <WorkspaceFilePathText file_path={file_path}>{children}</WorkspaceFilePathText>;
}

function link_file_paths_in_text(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let end_of_last_path = 0;
  for (const match of text.matchAll(path_in_text_pattern)) {
    const file_path = workspace_file_path_from_href(match[0]);
    if (!file_path) continue;
    parts.push(
      text.slice(end_of_last_path, match.index),
      <WorkspaceFilePathText key={match.index} file_path={file_path}>
        {match[0]}
      </WorkspaceFilePathText>,
    );
    end_of_last_path = match.index + match[0].length;
  }
  return parts.length === 0 ? text : [...parts, text.slice(end_of_last_path)];
}
