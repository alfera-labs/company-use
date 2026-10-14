const slack_reply_protocol = [
  '## Slack Reply Protocol',
  'The runtime already decided that the latest message is for you before starting this run. Do not make a second audience decision and do not end silently. Answer the latest message without reviving an older request from the thread.',
  'The ONLY way they hear you is the slack-respond-1 tool: your plain assistant text is never delivered, so a turn that ends without a successful slack-respond-1 leaves them in total silence, no matter how good the answer you wrote.',
  'Answer as fast as you can. If you can answer now, send it now with one slack-respond-1 and stop. If the task needs real work first, open with one quick slack-respond-1 keep_working: true acknowledgement ("On it, give me a minute."), do the work, then send your final reply.',
  'Every accepted Slack turn ends with a delivering slack-respond-1 using resolution_type "reply". The turn is not finished until one has succeeded.',
].join('\n');

const chat_reply_protocol = [
  '## Chat Reply Protocol',
  'End every chat turn with one chat-respond-1 call. It is your reply: the person reads exactly what you put in its fields, and it ends your turn.',
  'answer first, in one or two sentences. Add details only when they need it to act. deliverable holds only something they asked you to write for them, never ideas or explanations. At most one next step.',
  'Short progress notes while you work stay plain text. The final reply is never plain text as well.',
].join('\n');

const reply_protocol_by_channel: Record<string, { text: string; steers_tools: readonly string[] }> =
  {
    slack: { text: slack_reply_protocol, steers_tools: ['slack-respond-1'] },
    dashboard: { text: chat_reply_protocol, steers_tools: ['chat-respond-1'] },
  };

export function channel_reply_sections(channel: string | undefined) {
  const protocol = channel ? reply_protocol_by_channel[channel] : undefined;
  return protocol ? [protocol] : [];
}
