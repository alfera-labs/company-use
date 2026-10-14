import { coworker_range_line } from '@coworker/shared';
import type { WorkflowProposal } from '@runtime-platform/discovery/workflow_proposals';

const count_words = ['One thing', 'Two things', 'Three things'];
const tool_list = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** The second public post of a first look: the best job played back as steps, the rest in a line each. */
export function render_discovery_offers_message(input: {
  proposals: WorkflowProposal[];
  connected_tool_names: string[];
}): string {
  const [lead, ...others] = input.proposals;
  if (!lead) return render_nothing_found_message();

  const count = count_words[input.proposals.length - 1] ?? `${input.proposals.length} things`;
  const playback = lead.owner_first_name
    ? `${lead.owner_first_name}, if I've got it right:`
    : "If I've got it right:";

  return [
    `Okay, I see how things run now. ${count} I'd love to take off your plates 👇`,
    [`**${without_full_stop(lead.title)}.** ${playback}`, ...lead.steps.map(as_bullet)].join('\n'),
    `${lead.offer} Did I miss a step?`,
    ...(others.length > 0
      ? [['Also on my list:', ...others.map((other) => as_bullet(other.short_offer))].join('\n')]
      : []),
    `And that's just what I spotted. ${coworker_range_line}`,
    reply_line(tools_still_to_connect(lead.tool_names, input.connected_tool_names)),
  ].join('\n\n');
}

/** What the first look says when the channels showed no job worth offering. */
export function render_nothing_found_message(): string {
  return [
    "Okay, I'm caught up. Nothing jumped out yet, so throw something at me. Honestly, anything:",
    [
      '"build the deck for Thursday\'s board meeting"',
      '"find 50 companies like our best customer and email each one"',
      '"chase every unpaid invoice until it\'s paid"',
      '"log into the supplier portal and pull last month\'s numbers"',
    ]
      .map(as_bullet)
      .join('\n'),
    `${coworker_range_line} Try me 😄`,
  ].join('\n\n');
}

function reply_line(tool_names: string[]) {
  if (tool_names.length === 0) return "Reply in this thread with a yes and that one's mine.";
  return `Reply in this thread with a yes and I'll send the links to connect ${tool_list.format(tool_names)}.`;
}

// A name match on letters and digits only. A catalog app named unlike the product
// (a versioned or prefixed key) reads as not connected, and the agent that answers the thread
// checks the real connections before it sends any link.
function tools_still_to_connect(tool_names: string[], connected_tool_names: string[]) {
  const connected = connected_tool_names.map(letters_and_digits).filter(Boolean);
  return tool_names.filter((tool_name) => {
    const wanted = letters_and_digits(tool_name);
    if (wanted === 'slack') return false;
    return !connected.some((name) => name.includes(wanted) || wanted.includes(name));
  });
}

function letters_and_digits(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function as_bullet(line: string) {
  return `• ${without_full_stop(line)}`;
}

function without_full_stop(text: string) {
  return text.trim().replace(/\.+$/u, '');
}
