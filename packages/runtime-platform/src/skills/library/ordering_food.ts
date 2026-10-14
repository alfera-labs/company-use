import { acting_for_the_person_online } from '@runtime-platform/skills/library/shared/acting_for_the_person_online';
import type { SkillDefinition } from '@runtime-platform/skills/types';

export const ordering_food_skill: SkillDefinition = {
  skill_slug: 'ordering-food',
  skill_name: 'Order food',
  description:
    'Use when the person wants food, drinks, or groceries ordered for delivery or pickup, or wants a past order repeated. Covers the delivery app flow from address to basket, how to handle allergies and substitutions, what to read back before paying, and how to confirm the order went through.',
  discovery_hint: 'Use to order food or groceries for delivery or pickup.',
  body: [
    '# Order food',
    '',
    '## What you need',
    'What they want, where it goes, and when. Use the delivery app they already have an account with, because their address and payment live there. If they did not say which, ask once.',
    '',
    '## Build the order',
    '1. Set the delivery address before anything else. The restaurants, the menu, the prices, and the delivery time all depend on it. Check that the address on the page is the one they mean, not a saved one from last time.',
    '2. Check the place is open and taking orders now, and read the delivery time it quotes. If they named a time, use the scheduled-order option rather than hoping.',
    '3. Add each item with its options. A dish is not chosen until its size, sides, and extras are. When an option is required and they did not say, pick the plain default and say which you picked.',
    '4. "The usual" or "same as last time" is in the order history on the app. Reorder from there instead of rebuilding it from memory.',
    '',
    '## Allergies are not a preference',
    "If they mentioned an allergy or a diet, read each item's description and allergen notes. Never infer that a dish is safe from its name. Put the allergy in the order note as well, and tell them a note is a request the kitchen may not honour. For a serious allergy, say plainly that only the restaurant can confirm.",
    '',
    '## Read the basket back',
    "Before you place it, list every item with its options, then the subtotal, delivery fee, service fee, tip, and the total. Add the address and the delivery time. Leave the tip at the app's default unless they said otherwise, and name the amount. Do not hunt for promo codes; use one only if they gave it or the app applied it itself.",
    'For groceries, set what happens when an item is out of stock: refund the item unless they asked for substitutes.',
    '',
    '## After you order',
    'Report the order number, the total charged, and the estimated arrival. Give them the tracking link. Do not sit watching the tracker; offer one check near the arrival time if they want it.',
    'If the restaurant cancels or an item is dropped, tell them at once with what the app is offering instead.',
    '',
    ...acting_for_the_person_online,
  ].join('\n'),
};
