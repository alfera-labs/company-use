import {
  describe_the_action,
  describe_the_action_in_place,
  no_label,
  yes_label,
} from '@shared/approval_words';
import { describe, expect, it } from 'vitest';

describe('the sentence an approval makes', () => {
  it('says what it will do, and where', () => {
    expect(describe_the_action_in_place('Send email', 'Gmail')).toBe('send email in Gmail');
  });

  it('says only what it will do when there is nowhere for it to happen', () => {
    expect(describe_the_action_in_place('Calculate')).toBe('calculate');
    expect(describe_the_action_in_place('Run a command')).toBe('run a command');
  });

  it.each([
    ['web_search', 'web search'],
    ['respond', 'respond'],
    ['send_message', 'send message'],
    ['load_skill', 'load skill'],
    ['read_history', 'read history'],
    ['create_scheduled_task', 'create scheduled task'],
    ['Send email', 'send email'],
    ['Refund a payment', 'refund a payment'],
    ['Create a page', 'create a page'],
    ['List channels', 'list channels'],
  ])('says %s as "%s"', (action_name, expected) => {
    expect(describe_the_action(action_name)).toBe(expected);
  });

  it('never mangles a name whose first word is not a verb', () => {
    expect(describe_the_action('Web search')).not.toBe('web a search');
    expect(describe_the_action_in_place('Respond in Slack', 'Slack')).not.toBe(
      'respond an in slack in Slack',
    );
  });

  it('does not name the place twice when the action already names it', () => {
    expect(describe_the_action_in_place('Respond in Slack', 'Slack')).toBe('respond in slack');
  });

  it('never puts work inside a built-in tool', () => {
    expect(describe_the_action_in_place('Calculate', undefined)).toBe('calculate');
  });
});

describe('what the buttons say', () => {
  it('answers the question instead of conjugating the tool name', () => {
    expect(yes_label('Send email')).toBe('Yes, go ahead');
    expect(yes_label('web search')).toBe('Yes, go ahead');
    expect(no_label('web search')).toBe("No, don't");
  });
});
