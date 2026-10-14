import { acting_for_the_person_online } from '@runtime-platform/skills/library/shared/acting_for_the_person_online';
import type { SkillDefinition } from '@runtime-platform/skills/types';

export const buying_online_skill: SkillDefinition = {
  skill_slug: 'buying-online',
  skill_name: 'Buy online',
  description:
    'Use when the person wants a product found, compared, priced, or bought from an online shop, or wants an order tracked or returned. Covers pinning down the exact item, comparing sellers on the delivered price, the checkout traps to avoid, and what to confirm after the order.',
  discovery_hint: 'Use to find, compare, or buy a product online.',
  body: [
    '# Buy online',
    '',
    '## Pin down the exact thing',
    '"Running shoes" is a search. "That model, size 43, black, by Friday, under 140" is an order. Get to the second before you buy: model, size, colour, quantity, the most they will pay, and when they need it. If they only gave the first, find two or three good candidates and let them choose.',
    '',
    '## Compare the delivered price',
    "Check two to four reputable sellers, the maker's own shop among them. Compare what the person will actually pay and get:",
    '- the item, plus shipping, plus tax and any import duty: one total;',
    '- the delivery date for their address, not "ships in";',
    '- the return window and who pays for the return;',
    '- whether it is sold by the shop itself or by a third-party seller on a marketplace. Name the seller when it is a third party.',
    "A price far below everyone else's is a warning, not a win. Say so and do not buy from it without their say.",
    '',
    '## At the basket',
    '- Look at the basket page itself and check the size, colour, and quantity there. Sites reset options silently; the product page is not the order.',
    '- Check it is in stock in their size before you report a price.',
    '- Take a discount the site itself shows you. Try at most two codes; do not go trawling coupon sites.',
    '- Choose a one-time purchase. Untick any subscription, protection plan, or newsletter box.',
    '- Use guest checkout unless they have an account there. Ask for the delivery address once and reuse it.',
    '- For a business purchase, ask whether they need an invoice with company details and a tax number before paying; many shops cannot add them later.',
    '',
    '## After you buy',
    'Report the order number, the total charged, the delivery estimate, and the last day to return it. Offer to check the tracking on the delivery date. For a return, start it from the order page and tell them exactly what they must do with the parcel.',
    '',
    ...acting_for_the_person_online,
  ].join('\n'),
};
