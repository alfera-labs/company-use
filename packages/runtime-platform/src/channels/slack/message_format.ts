import { render_markdown_tables_as_fences } from '@runtime-platform/channels/slack/slack_table_format';

// Slack renders "mrkdwn", not Markdown, and the model writes Markdown. Everything outbound is
// translated here.
//
// APPLY THIS EXACTLY ONCE, at the Slack API call site. It is deliberately NOT idempotent: the
// `*bold*` this pass produces is Markdown *italic*, so a second pass would turn bold into italic.
// Plain prose with no Markdown in it is a no-op, which is what makes it safe to sit on the shared
// send helpers that hand-authored notices also flow through. Store and persist the raw Markdown;
// convert only on the way out.

const stash_marker = '\u{e000}';
const bold_sentinel = '\u{e001}';

const fenced_code_pattern = /```[\s\S]*?```/g;
const inline_code_pattern = /(`+)[^\n]*?\1/g;
const image_pattern = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const link_pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const slack_token_pattern = /<[@#!][^>\s]*(?:\|[^>\n]*)?>|<https?:\/\/[^>\s]*(?:\|[^>\n]*)?>/g;
const bare_url_pattern = /https?:\/\/[^\s<>]+/g;
const placeholder_pattern = /\u{e000}(\d+)\u{e000}/gu;

const horizontal_rule_pattern = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const heading_pattern = /^(#{1,6})\s+(.*)$/;
const bullet_pattern = /^(\s*)[-*+]\s+/;
const strikethrough_pattern = /~~(?!\s)([^\n]*?[^\s~])~~/g;
const bold_star_pattern = /\*\*(?!\s)([^\n]*?[^\s*])\*\*/g;
const bold_underscore_pattern = /__(?!\s)([^\n]*?[^\s_])__/g;
const italic_star_pattern = /(^|[\s([{])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/gm;

const slack_horizontal_rule = '──────────';

// Slack rejects chat.postMessage text over 40k characters; keep headroom for the marker.
export const slack_text_limit = 39_000;

export function slack_message_text_from_markdown(markdown: string) {
  return truncate_mrkdwn_for_slack(format_slack_mrkdwn_text(markdown));
}

export function format_slack_mrkdwn_text(text: string) {
  const stash: string[] = [];
  const stashed = stash_verbatim_regions(text, stash);
  return unstash_verbatim_regions(convert_markdown_body(stashed), stash);
}

function stash_verbatim_regions(text: string, stash: string[]) {
  const keep = (value: string) => `${stash_marker}${stash.push(value) - 1}${stash_marker}`;
  const stages = [
    (value: string) => value.replace(fenced_code_pattern, keep),
    (value: string) => render_markdown_tables_as_fences(value, keep),
    (value: string) => value.replace(inline_code_pattern, keep),
    (value: string) =>
      value.replace(image_pattern, (_match, alt: string, url) => keep(`<${url}|${alt || url}>`)),
    (value: string) =>
      value.replace(link_pattern, (_match, label: string, url) =>
        // Slack shows a link label as literal text, so emphasis markers inside it would be visible.
        keep(`<${url}|${label.replace(/\*\*|__/g, '')}>`),
      ),
    (value: string) => value.replace(slack_token_pattern, keep),
    (value: string) => value.replace(bare_url_pattern, (url) => stash_bare_url(url, keep)),
  ];
  return stages.reduce((value, stage) => stage(value), text);
}

function unstash_verbatim_regions(text: string, stash: string[]) {
  return text.replace(placeholder_pattern, (match, index: string) => stash[Number(index)] ?? match);
}

function stash_bare_url(url: string, keep: (value: string) => string) {
  let linked = url;
  let trailing = '';
  while (linked.length > 0) {
    const last = linked.slice(-1);
    const unbalanced_paren =
      last === ')' && count_character(linked, '(') < count_character(linked, ')');
    if (!'.,;:!?'.includes(last) && !unbalanced_paren) break;
    trailing = last + trailing;
    linked = linked.slice(0, -1);
  }
  return `${keep(`<${linked}>`)}${trailing}`;
}

function count_character(text: string, character: string) {
  return text.split(character).length - 1;
}

function convert_markdown_body(text: string) {
  const lines = text.split('\n').map(convert_markdown_line).join('\n');
  return convert_inline_markdown(lines).replaceAll(bold_sentinel, '*');
}

function convert_markdown_line(line: string) {
  if (horizontal_rule_pattern.test(line)) return slack_horizontal_rule;
  const heading = heading_pattern.exec(line);
  if (heading) {
    const title = (heading[2] ?? '').replace(/\*\*|__/g, '').trim();
    return title ? `${bold_sentinel}${title}${bold_sentinel}` : '';
  }
  return line.replace(bullet_pattern, '$1• ');
}

function convert_inline_markdown(text: string) {
  return escape_slack_entities(text)
    .replace(strikethrough_pattern, '~$1~')
    .replace(bold_star_pattern, (_match, content: string) => wrap_in_bold_sentinel(content))
    .replace(bold_underscore_pattern, (_match, content: string) => wrap_in_bold_sentinel(content))
    .replace(italic_star_pattern, '$1_$2_');
}

function wrap_in_bold_sentinel(content: string) {
  return `${bold_sentinel}${content}${bold_sentinel}`;
}

// Slack reads `&`, `<` and `>` as entity syntax. Every `<…>` Slack token — mentions, channel refs
// and the `<url|label>` links this module generates — is already stashed, so only genuine plain
// text reaches here. A line-leading `>` stays a blockquote, which Slack renders natively.
export function escape_slack_entities(text: string) {
  return text
    .replace(/&(?!(?:amp|lt|gt);)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replace(/^(\s*>+)|>/gm, (_match, blockquote?: string) => blockquote ?? '&gt;');
}

export function truncate_mrkdwn_for_slack(text: string) {
  if (text.length <= slack_text_limit) return text;
  const cut = text.slice(0, slack_text_limit);
  const fence_left_open = count_fences(cut) % 2 === 1;
  return `${cut}${fence_left_open ? '\n```' : ''}\n…(truncated)`;
}

function count_fences(text: string) {
  return text.match(/```/g)?.length ?? 0;
}
