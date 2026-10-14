import { slack_message_text_from_markdown } from '@runtime-platform/channels/slack/message_format';
import {
  render_discovery_offers_message,
  render_nothing_found_message,
} from '@runtime-platform/discovery/discovery_offer_message';
import { describe, expect, it } from 'vitest';

const monday_report = {
  title: 'The Monday sales report.',
  owner_first_name: 'Alex',
  steps: ['pull the deals from HubSpot.', 'add them to the Google Sheet'],
  offer: 'I can do all of that, every Monday at 9.',
  short_offer: 'build the Monday sales report',
  tool_names: ['HubSpot', 'Stripe', 'Google Sheets', 'Slack'],
};

describe('the first-look post in Slack', () => {
  it('reads as one person playing a job back, with the title in real Slack bold', () => {
    const text = slack_message_text_from_markdown(
      render_discovery_offers_message({ proposals: [monday_report], connected_tool_names: [] }),
    );

    expect(text).toBe(
      [
        "Okay, I see how things run now. One thing I'd love to take off your plates 👇",
        "*The Monday sales report.* Alex, if I've got it right:\n• pull the deals from HubSpot\n• add them to the Google Sheet",
        'I can do all of that, every Monday at 9. Did I miss a step?',
        "And that's just what I spotted. Pretty much anything a person can do on a laptop, I can run on autopilot.",
        "Reply in this thread with a yes and I'll send the links to connect HubSpot, Stripe and Google Sheets.",
      ].join('\n\n'),
    );
  });

  it('asks only for the tools that are not connected yet, and never for Slack', () => {
    const text = render_discovery_offers_message({
      proposals: [monday_report],
      connected_tool_names: ['hubspot', 'google_sheets', 'slack'],
    });

    expect(text).toContain("I'll send the links to connect Stripe.");
  });

  it('takes the job at once when every tool is already connected', () => {
    const text = render_discovery_offers_message({
      proposals: [{ ...monday_report, owner_first_name: null }],
      connected_tool_names: ['hubspot', 'stripe', 'googlesheets'],
    });

    expect(text).toContain("**The Monday sales report.** If I've got it right:");
    expect(text).toContain("Reply in this thread with a yes and that one's mine.");
  });

  it('never writes an em dash, in the offers or when it found nothing', () => {
    const offers = render_discovery_offers_message({
      proposals: [monday_report, monday_report, monday_report],
      connected_tool_names: [],
    });

    expect(offers).toContain('Three things');
    expect(offers).toContain('Also on my list:');
    expect(`${offers}${render_nothing_found_message()}`).not.toContain('—');
  });
});
