import {
  format_slack_mrkdwn_text,
  slack_text_limit,
  truncate_mrkdwn_for_slack,
} from '@runtime-platform/channels/slack/message_format';
import { describe, expect, it } from 'vitest';

describe('format_slack_mrkdwn_text', () => {
  it('converts common Markdown link and bold syntax to Slack mrkdwn', () => {
    expect(
      format_slack_mrkdwn_text(
        'Read [the doc](https://docs.google.com/document/d/abc) and **confirm**.',
      ),
    ).toBe('Read <https://docs.google.com/document/d/abc|the doc> and *confirm*.');
  });

  it('keeps bold and italic apart when both appear on one line', () => {
    expect(format_slack_mrkdwn_text('**b** and *i* together')).toBe('*b* and _i_ together');
  });

  it('converts a bold-wrapped link and a link with a bold label', () => {
    expect(format_slack_mrkdwn_text('**[the doc](https://example.com)**')).toBe(
      '*<https://example.com|the doc>*',
    );
    expect(format_slack_mrkdwn_text('[**the doc**](https://example.com)')).toBe(
      '<https://example.com|the doc>',
    );
  });

  it('leaves mid-word asterisks and underscores alone', () => {
    expect(format_slack_mrkdwn_text('2*3*4 and file_name_here stay put')).toBe(
      '2*3*4 and file_name_here stay put',
    );
  });

  it('passes a fenced code block through byte-identical', () => {
    const fence = [
      '```md',
      '# heading',
      '**bold**',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      'https://example.com',
      '```',
    ].join('\n');
    expect(format_slack_mrkdwn_text(`Before\n${fence}\nAfter`)).toBe(`Before\n${fence}\nAfter`);
  });

  it('leaves inline code with asterisks untouched', () => {
    expect(format_slack_mrkdwn_text('Run `a ** b` then **go**.')).toBe('Run `a ** b` then *go*.');
  });

  it('renders a Markdown table as an aligned monospace fence', () => {
    const table = ['| Name | Runs |', '| --- | ---: |', '| alpha | 12 |', '| b | 3 |'].join('\n');
    expect(format_slack_mrkdwn_text(table)).toBe(
      ['```', 'Name  | Runs', '------+-----', 'alpha | 12', 'b     | 3', '```'].join('\n'),
    );
  });

  it('converts headings, bullets, ordered lists, strikethrough and rules', () => {
    const markdown = [
      '## Results',
      '- top',
      '  - nested',
      '* star bullet',
      '1. first',
      '2. second',
      '~~dropped~~',
      '---',
    ].join('\n');
    expect(format_slack_mrkdwn_text(markdown)).toBe(
      [
        '*Results*',
        '• top',
        '  • nested',
        '• star bullet',
        '1. first',
        '2. second',
        '~dropped~',
        '──────────',
      ].join('\n'),
    );
  });

  it('links a bare URL and keeps its trailing punctuation outside the link', () => {
    expect(format_slack_mrkdwn_text('See https://example.com/a_(b).')).toBe(
      'See <https://example.com/a_(b)>.',
    );
    expect(format_slack_mrkdwn_text('(see https://example.com).')).toBe(
      '(see <https://example.com>).',
    );
  });

  it('escapes entities in plain text without touching mentions, emoji or generated links', () => {
    expect(
      format_slack_mrkdwn_text(
        'a < b && c > d, ping <@U123> in <#C456|ops> :tada: [x](https://e.co)',
      ),
    ).toBe('a &lt; b &amp;&amp; c &gt; d, ping <@U123> in <#C456|ops> :tada: <https://e.co|x>');
  });

  it('keeps a line-leading blockquote marker as a blockquote', () => {
    expect(format_slack_mrkdwn_text('> quoted line\nnot > quoted')).toBe(
      '> quoted line\nnot &gt; quoted',
    );
  });

  it('is a no-op on hand-authored plain prose', () => {
    const notice =
      "I finished working on that but couldn't post a reply. Send it again and I'll pick it back up.";
    expect(format_slack_mrkdwn_text(notice)).toBe(notice);
  });

  it('leaves already-converted output stable except for the documented bold-to-italic collision', () => {
    const converted = format_slack_mrkdwn_text('**bold**');
    expect(converted).toBe('*bold*');
    expect(format_slack_mrkdwn_text(converted)).toBe('_bold_');
  });
});

describe('truncate_mrkdwn_for_slack', () => {
  it('leaves text within the limit alone', () => {
    expect(truncate_mrkdwn_for_slack('short')).toBe('short');
  });

  it('closes an open code fence before the truncation marker', () => {
    const truncated = truncate_mrkdwn_for_slack(`\`\`\`\n${'x'.repeat(slack_text_limit)}`);
    expect(truncated.endsWith('\n```\n…(truncated)')).toBe(true);
  });

  it('does not add a fence when the cut lands outside one', () => {
    const truncated = truncate_mrkdwn_for_slack('y'.repeat(slack_text_limit + 10));
    expect(truncated.endsWith('y\n…(truncated)')).toBe(true);
  });
});
