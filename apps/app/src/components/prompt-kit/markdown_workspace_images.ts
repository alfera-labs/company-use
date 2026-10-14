import { is_image_file } from '@/components/app/workspace_file_visuals';
import { workspace_file_path_from_href } from '@/components/prompt-kit/markdown_file_links';
import { workspace_file_download_url } from '@/lib/api';

type MarkdownTreeNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
};

/**
 * The address an answer's image loads from, when the image names a file of the workspace: the
 * same address the Files panel reads, so it shows only what the person may open there. Any other
 * address is returned as it is and stays under the rules of the markdown renderer.
 */
export function workspace_image_address(src: string) {
  const file_path = workspace_file_path_from_href(src);
  return file_path && is_image_file(file_path) ? workspace_file_download_url(file_path) : src;
}

/**
 * A markdown tree step that points each workspace image at its file. Without it the renderer
 * refuses a bare path such as `files/chart.png` and prints "[Image blocked]".
 */
export function show_workspace_file_images() {
  return function point_images_at_workspace_files(node: MarkdownTreeNode) {
    if (node.tagName === 'img' && typeof node.properties?.src === 'string') {
      node.properties.src = workspace_image_address(node.properties.src);
    }
    for (const child of node.children ?? []) point_images_at_workspace_files(child);
  };
}
