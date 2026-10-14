import remark_breaks from 'remark-breaks';
import { defaultRehypePlugins, defaultRemarkPlugins, type StreamdownProps } from 'streamdown';
import { show_fetching_diagrams_as_text } from '@/components/prompt-kit/markdown_diagram_guard';
import { show_workspace_file_images } from '@/components/prompt-kit/markdown_workspace_images';

type RehypeSteps = NonNullable<StreamdownProps['rehypePlugins']>;

/**
 * The renderer's own steps, with their rules for links and raw HTML, after two steps of ours:
 * one gives an image of a workspace file its address, one keeps a diagram that could fetch from
 * another site as text. The picture component decides which images the browser may load.
 */
export const rehype_steps: RehypeSteps = [
  show_workspace_file_images,
  show_fetching_diagrams_as_text,
  ...Object.entries(defaultRehypePlugins).map(([name, step]) =>
    name === 'sanitize' ? keep_pictures_held_in_the_text(step) : step,
  ),
];

/**
 * The renderer's cleaning step, told to keep a `data:` address on an image. The step after it
 * lets only `data:image/` through. When the step has another shape, it is used as it is, and
 * such pictures stay out.
 */
export function keep_pictures_held_in_the_text(step: RehypeSteps[number]): RehypeSteps[number] {
  if (!Array.isArray(step)) return step;
  const [clean, rules] = step as [RehypeSteps[number], { protocols?: Record<string, string[]> }];
  const protocols = rules?.protocols ?? {};
  const kept = { ...protocols, src: [...(protocols.src ?? []), 'data'] };
  return [clean, { ...rules, protocols: kept }] as RehypeSteps[number];
}

/**
 * The renderer's own steps, then one that keeps a single line break as a line break on the
 * screen ("one number per line"). Plain markdown joins such lines into one paragraph.
 */
export const remark_steps: NonNullable<StreamdownProps['remarkPlugins']> = [
  ...Object.values(defaultRemarkPlugins),
  remark_breaks,
];
