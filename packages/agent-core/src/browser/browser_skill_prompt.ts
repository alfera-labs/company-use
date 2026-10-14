import { render_browser_operating_guide } from '@agent-core/browser/browser_operating_guide';

export function build_browser_skill_prompt(core_skill_markdown: string): string {
  return [core_skill_markdown.trim(), '# Operating guide', render_browser_operating_guide()].join(
    '\n\n',
  );
}
