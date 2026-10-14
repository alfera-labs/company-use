import { acting_for_the_person_online } from '@runtime-platform/skills/library/shared/acting_for_the_person_online';
import type { SkillDefinition } from '@runtime-platform/skills/types';

export const booking_a_table_skill: SkillDefinition = {
  skill_slug: 'booking-a-table',
  skill_name: 'Book a table',
  description:
    'Use when the person wants a recommendation for a restaurant, bar, cafe, or place to go, or wants a table reserved, changed, or cancelled. Covers how to recommend places that are real and open, how to check true availability, and what to confirm before and after booking.',
  discovery_hint: 'Use to recommend restaurants or places to go, and to reserve a table.',
  body: [
    '# Book a table',
    '',
    '## What you need',
    'Party size, date, a time window, and the area. Occasion, cuisine, budget, and dietary needs sharpen the pick but are not worth a round of questions; recommend with what you have and say what you assumed.',
    '',
    '## Recommend places that exist',
    'A recommendation from memory is a guess. Places close, move, and change hands. For every place you name, check now:',
    '- it is open on that day and at that time, from its own site or a current listing;',
    '- recent reviews, from more than one source, still say what you are about to say;',
    '- it fits the party: a table for eight, a quiet room, step-free access, or a real vegan menu are things to verify, not assume.',
    'Give three options at most. For each: one honest line on why it fits, the price level, the distance or neighbourhood, and a link. Say which you would choose.',
    '',
    '## Check real availability',
    "Open the restaurant's own booking page or the booking service it links to, enter the party size and date, and read the times it actually offers. Offer those exact times. If nothing fits, show the nearest times on both sides and the same window on the next day.",
    'If the place only takes bookings by phone or email, say so. You cannot place a phone call. Give them the number and the three facts to say, or draft the email for them to approve.',
    '',
    '## Book it',
    '- You need the name the booking is under, a mobile number, and an email. Ask once and reuse them.',
    '- Put allergies, a high chair, a wheelchair, or the occasion in the booking notes. An allergy goes in the notes every time.',
    '- Many places take a card to hold the table or charge for a no-show. That is a charge: read the policy and the amount back before you confirm.',
    '',
    '## After you book',
    'Report the confirmation reference, the exact time, the name it is under, and the cancellation deadline. Offer a calendar event with the address in it. To change or cancel, use the link in the confirmation rather than making a second booking.',
    '',
    ...acting_for_the_person_online,
  ].join('\n'),
};
