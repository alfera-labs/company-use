import Image from '@tiptap/extension-image';
import {
  read_picture_source,
  workspace_picture_paths,
} from '@/components/prompt-kit/picture_source';
import { workspace_file_download_url } from '@/lib/api';

/**
 * The picture of a document in the visual editor, under the rule of the pictures in an answer:
 * a workspace file and a picture held in the text load at once, a picture of another site loads
 * after the person asks, and no other address loads. The document keeps the address as written.
 */
export const GuardedPicture = Image.extend({
  addNodeView() {
    return ({ node }) => ({
      dom: draw_guarded_picture(String(node.attrs.src ?? ''), String(node.attrs.alt ?? '')),
    });
  },
});

/** Draws one picture of a document with plain elements, for the editor, which is not React. */
export function draw_guarded_picture(address: string, alt: string) {
  const frame = document.createElement('span');
  const source = read_picture_source(address);
  const name = alt.trim() || 'Picture';
  if (source.kind === 'workspace_file') {
    show_workspace_picture(frame, workspace_picture_paths(source.file_path, []), alt.trim());
  } else if (source.kind === 'held_in_the_text') {
    frame.replaceChildren(picture_element(source.address, name));
  } else if (source.kind === 'other_site') {
    frame.replaceChildren(show_picture_button(frame, source, name));
  } else {
    frame.textContent = name;
  }
  return frame;
}

function picture_element(address: string, name: string) {
  const picture = document.createElement('img');
  picture.alt = name;
  picture.referrerPolicy = 'no-referrer';
  picture.src = address;
  return picture;
}

function show_workspace_picture(frame: HTMLElement, paths: readonly string[], name: string) {
  const [path, ...later_paths] = paths;
  if (!path) {
    frame.textContent = name || 'Picture';
    return;
  }
  const file_name = path.slice(path.lastIndexOf('/') + 1);
  const picture = picture_element(workspace_file_download_url(path), name || file_name);
  picture.hidden = true;
  picture.onload = () => {
    picture.hidden = false;
  };
  picture.onerror = () => show_workspace_picture(frame, later_paths, name || file_name);
  frame.replaceChildren(picture);
}

function show_picture_button(
  frame: HTMLElement,
  source: { host: string; address: string },
  name: string,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = source.address;
  button.textContent = `Show picture from ${source.host}`;
  button.onclick = () => frame.replaceChildren(picture_element(source.address, name));
  return button;
}
