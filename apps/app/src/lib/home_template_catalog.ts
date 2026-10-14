// GENERATED FILE — do not edit by hand.
// Source: packages/core/src/templates/library/*/{SKILL.md,alfera.json}, flattened so the home
// page can show the template shelf with zero fetches. Regenerate it whenever the library changes.

export type HomeTemplate = {
  slug: string;
  name: string;
  /** The one-line pitch under the name. */
  summary: string;
  category: 'sales' | 'support' | 'finance' | 'operations' | 'events';
  kind: 'task' | 'skill';
  /** "Mondays, 9:00" / "When a ticket arrives" / "On request". */
  when_line: string;
  /** Display names the catalog icon pipeline resolves to app marks. */
  app_aliases: string[];
  /** What lands in the composer on click: the ask, connections, questions, schedule, instruction. */
  setup_message: string;
};

export const home_templates: HomeTemplate[] = [
  {
    slug: 'answer-the-repeat-questions',
    name: 'Answer the repeat questions',
    summary: 'Answer the questions you have already settled, and leave the rest alone.',
    category: 'support',
    kind: 'task',
    when_line: 'When a ticket arrives',
    app_aliases: ['Zendesk'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Answer the repeat questions\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Zendesk: The tickets it reads and replies to.\n\nAsk me before you create anything:\n- The queue it answers from\n- Which questions it may answer\n\nIt should run:\n- when a ticket arrives — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Answer the repeat questions\n\n## What to do\n\n1. Read the ticket. Find whether this exact question has a settled answer in past replies or the help centre.\n2. If it does, answer it in the same words this workspace already uses.\n3. If it does not, leave the ticket untouched and move on.\n\n## Rules\n\n- Never answer anything touching a refund, a price, an account deletion, or a mistake made by us.\n- Never write a new answer. If the answer does not exist yet, that is a human decision to make once.\n- One reply per ticket, then stop.',
  },
  {
    slug: 'book-a-follow-up-from-a-reply',
    name: 'Book a follow-up from a reply',
    summary: 'Turn “next week works” into an invite before the thread goes cold.',
    category: 'sales',
    kind: 'task',
    when_line: 'When they reply with a time',
    app_aliases: ['Gmail', 'Google Calendar'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Book a follow-up from a reply\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Gmail: The reply it reads.\n- Google Calendar: Where the invite goes.\n\nAsk me before you create anything:\n- The calendar it books in\n- How long the meeting is\n\nIt should run:\n- when they reply with a time — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Book a follow-up from a reply\n\n## What to do\n\n1. Read the reply for availability. "Next week", "after Tuesday", "mornings" are all usable.\n2. Find a slot that works for everyone already on the thread. Respect working hours in their timezone, not yours.\n3. Send the invite in the existing thread, with the agenda line from the thread as the title.\n\n## Rules\n\n- One proposed slot, not three. Three slots is a form to fill in.\n- If the reply gives no usable window, reply asking for one. Do not invent Tuesday at 10.\n- Never move an existing meeting to make room.',
  },
  {
    slug: 'brief-me-before-a-renewal',
    name: 'Brief me before a renewal',
    summary: 'See what they bought, used, and complained about a month before the date.',
    category: 'sales',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['HubSpot', 'Zendesk'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Brief me before a renewal\n\nIt needs these connections — check them, and help me connect any that are missing:\n- HubSpot: The account and the renewal date.\n- Zendesk (optional): What went wrong during the term.\n\nAsk me before you create anything:\n- How far ahead to look\n- Where the brief goes\n\nIt should run:\n- on the schedule `0 8 * * MON` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Brief me before a renewal\n\n## What to do\n\n1. Find accounts with a renewal date thirty days out.\n2. For each: what they bought, what changed during the term, every support issue and how it ended, every request that went unanswered.\n3. Put the unanswered requests at the top. That is what they will open with.\n\n## Rules\n\n- An account with no contact and no tickets is not healthy, it is quiet. Say so.\n- One page. If it runs longer, cut the history, not the open items.',
  },
  {
    slug: 'build-a-seating-plan-from-rsvps',
    name: 'Build a seating plan from RSVPs',
    summary: 'Build tables that respect the notes people wrote, not just the headcount.',
    category: 'events',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Google Sheets'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Build a seating plan from RSVPs\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Sheets: The RSVP list and the plan it writes back.\n\nAsk me before you create anything:\n- The RSVP sheet\n- Your table sizes\n\nIt should run:\n- on request, whenever I ask\n\n# Build a seating plan from RSVPs\n\n## What to do\n\n1. Read the RSVP list. Group by household first: nobody is separated from who they arrived with.\n2. Apply every explicit constraint in the notes column. These are hard, not preferences.\n3. Fill tables to the stated capacity, keeping groups whole where you can.\n4. Write the plan to its own tab, with dietary requirements in a column the kitchen reads.\n\n## Rules\n\n- A "please not next to" is never traded off for a neater table count.\n- If a constraint cannot be met, say which one and why. Never break it silently.',
  },
  {
    slug: 'chase-missing-receipts-from-the-team',
    name: 'Chase missing receipts from the team',
    summary: 'Chase the card lines with nothing attached, person by person.',
    category: 'finance',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Xero', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Chase missing receipts from the team\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Xero: Which transactions have nothing attached.\n- Slack: Where each person gets their own list.\n\nAsk me before you create anything:\n- Which cards to watch\n- Where each person is messaged\n\nIt should run:\n- on the schedule `0 10 * * THU` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Chase missing receipts from the team\n\n## What to do\n\n1. Find card transactions older than seven days with no receipt attached.\n2. Group by cardholder. One message per person, listing everything they owe.\n3. At thirty days, list the outstanding ones to the finance owner. Once, not weekly.\n\n## Rules\n\n- Never post a list of names into a shared channel.\n- Never chase the same transaction more than once a week.',
  },
  {
    slug: 'chase-overdue-invoices',
    name: 'Chase overdue invoices',
    summary: "Nudge what's overdue in your tone, and track who replied.",
    category: 'finance',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Xero', 'Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Chase overdue invoices\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Xero: Which invoices are outstanding and by how long.\n- Gmail: Where the nudge goes out from.\n\nAsk me before you create anything:\n- When an invoice counts as overdue\n- Who the nudge comes from\n\nIt should run:\n- on the schedule `0 9 * * MON` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Chase overdue invoices\n\n## What to do\n\n1. Pull unpaid invoices past their due date. Group them by how late: under 14 days, 14 to 30, over 30.\n2. Send the wording for that band to the billing contact on the invoice.\n3. Record the chase. Stop the sequence the moment a human replies.\n4. Hand back the over-30 list for a person to call.\n\n## Rules\n\n- Never chase an invoice flagged as in dispute or on a payment plan.\n- Never chase twice in one week, whatever the age.\n- Never name a consequence you cannot follow through on.',
  },
  {
    slug: 'chase-the-final-headcount',
    name: 'Chase the final headcount',
    summary: 'Chase the guests who never replied, up to the caterer deadline.',
    category: 'events',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Google Sheets', 'Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Chase the final headcount\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Sheets: The guest list and its replies.\n- Gmail: Where the chase goes out from.\n\nAsk me before you create anything:\n- The guest list\n- The caterer deadline\n\nIt should run:\n- on the schedule `0 10 * * *` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Chase the final headcount\n\n## What to do\n\n1. Work out the chase dates backwards from the catering deadline: fourteen days, seven days, three days.\n2. On each date, email one person per household that has not replied.\n3. Three days out, stop emailing and hand the remaining list over for phone calls.\n\n## Rules\n\n- One email per household. Chasing four people at one address is how you lose a guest.\n- A "no" is a reply. Stop chasing immediately.\n- Never chase past the deadline. After that the number is the number.',
  },
  {
    slug: 'close-the-month',
    name: 'Close the month',
    summary: "Run your close checklist, chase what's missing, report what's left.",
    category: 'finance',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Xero', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Close the month\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Xero: The ledger it reconciles against.\n- Slack (optional): Where it chases people.\n\nAsk me before you create anything:\n- Your close checklist\n- Where it chases people\n\nIt should run:\n- on the schedule `0 9 1 * *` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Close the month\n\n## What to do\n\n1. Read the workspace close checklist. If there is not one, ask for it once and stop.\n2. For each step, check whether the underlying thing is actually done in the ledger.\n3. Chase the named owner of anything missing, individually.\n4. Report what is still outstanding, once a day, until nothing is.\n\n## Rules\n\n- A step is done when the ledger says so, not when someone says so.\n- Never adjust a figure to make something reconcile.',
  },
  {
    slug: 'draft-follow-ups-after-meetings',
    name: 'Draft follow-ups after every meeting',
    summary: 'Leave a next-step draft in your drafts after every meeting.',
    category: 'sales',
    kind: 'task',
    when_line: 'When a meeting ends',
    app_aliases: ['Google Calendar', 'Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Draft follow-ups after every meeting\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Calendar: How it knows a meeting ended and who was in it.\n- Gmail: Where the draft is left.\n\nAsk me before you create anything:\n- Which meetings count\n- Where the notes come from\n\nIt should run:\n- when a meeting ends — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Draft follow-ups after every meeting\n\n## What to do\n\n1. Take the notes, transcript or agenda for the meeting that just ended.\n2. Find the single thing that has to happen next, and who owns it. If the notes name three, pick the one that unblocks the others.\n3. Draft a reply in the existing thread. One line that proves you were there, the next step, a date.\n4. Leave it as a draft. Never send it.\n\n## Rules\n\n- No recap paragraph. They were in the meeting.\n- If nothing was agreed, the draft says so and asks one question.\n- If the workspace has taught you how it writes follow-ups, that wins over anything here.',
  },
  {
    slug: 'enrich-leads',
    name: 'Enrich a list of leads',
    summary: 'Add the right contact and one factual reason to reach out.',
    category: 'sales',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Google Sheets', 'LinkedIn'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Enrich a list of leads\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Sheets: Reads your lead list and writes results back.\n- LinkedIn (optional): Improves contact matching. The task still works without it.\n\nAsk me before you create anything:\n- The Google Sheet\n- The input and output columns\n\nIt should run:\n- on request, whenever I ask\n- on the schedule `0 8 * * MON` (a schedule) — confirm the time and timezone with me first\n\n# Enrich a list of leads\n\nYou are given a sheet with one company per row. Fill in the missing columns so that every row\neither has a contact and a reason to reach out, or a blank with a note saying why not.\n\n## What to do\n\n1. Read the sheet. The first column holds a company name or a domain; ignore any row where both\n   are empty.\n2. For each company, find its size band, sector and head-office country. Use the company\'s own\n   site first; fall back to public directories. Never guess a number.\n3. Pick one person. Read `references/titles.md` for which job titles count, in priority order.\n   If the workspace has taught you who its good customers look like, follow that instead — it is\n   more specific than this file and it wins.\n4. Write the "why now" from something that actually happened in the last six months: a hire, a\n   launch, a funding round, a new location, a system migration. One sentence, with the date.\n5. Fill the columns listed in `references/columns.md`, in that order, and nothing else.\n\n## When you cannot find something\n\nLeave the cell blank and put the reason in the `notes` column: "no ops hire found since Jan",\n"site is a holding page", "two companies share this name". A blank with a reason is useful. An\ninvented contact is worse than an empty row, because someone will email it.\n\n## Finishing\n\nWrite the rows back in one pass, not one row at a time. Then say how many rows you filled, how\nmany you left blank, and the single most common reason for the blanks.',
  },
  {
    slug: 'escalate-what-is-going-wrong',
    name: 'Escalate what is going wrong',
    summary: 'Raise the third report of the same thing as one incident.',
    category: 'support',
    kind: 'task',
    when_line: 'Through the working day',
    app_aliases: ['Zendesk', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Escalate what is going wrong\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Zendesk: The queue it watches.\n- Slack: Where an incident gets raised.\n\nAsk me before you create anything:\n- Where an incident is raised\n- How many reports make a cluster\n\nIt should run:\n- on the schedule `*/30 8-20 * * *` (through the working day) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Escalate what is going wrong\n\n## What to do\n\n1. Look at what arrived in the last hour. Group by what actually broke, not by wording.\n2. Three or more reports of the same thing, or one from an account over a threshold, is an incident.\n3. Raise it once with: what broke, how many, which accounts, when it started. Update that same thread; never start a second one.\n\n## Rules\n\n- Never raise the same incident twice.\n- Never guess a cause. Report what customers are seeing.\n- Say nothing when nothing is clustering. This has to stay worth reading.',
  },
  {
    slug: 'how-we-name-things-in-the-crm',
    name: 'How we name things in the CRM',
    summary: 'Stop the same company existing four times, and keep search working.',
    category: 'operations',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: How we name things in the CRM\n\nAsk me before you create anything:\n- Your deal name pattern\n- How you write company names\n\n# How we name things in the CRM\n\n## Fill this in\n\n```\nCompany name   <the trading name, no Ltd/Inc, no punctuation>\nDeal name      <company · what · period>\nMatched on     <root domain first, then normalised name>\nNever in a name <legal suffix, region, stage, owner initials>\n```\n\n## Why the deal shape\n\nNaming a deal `company · what · period` means an alphabetical list is also a useful list. Anything with a stage or an owner in the name goes stale the moment either changes, and then the name is a lie.\n\n## Duplicates\n\nMatch on root domain before anything else. "Acme", "ACME Ltd" and "Acme Group" are one record if they share a domain and three if you match on name.',
  },
  {
    slug: 'how-we-talk-about-price',
    name: 'How we talk about price',
    summary: 'Keep pricing and discount language consistent.',
    category: 'sales',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: How we talk about price\n\nAsk me before you create anything:\n- What you say first\n- What you trade for a discount\n- Never say\n\n# How we talk about price\n\n## The four moves\n\n1. **Find out which objection it is.** "Expensive" means either "more than I budgeted", "more than the other quote", or "I do not see the value yet". They need three different answers.\n2. **Answer that one.** Do not answer all three; it sounds defensive.\n3. **If you move, move scope.** A lower price for less work is a deal. A lower price for the same work says the first number was fiction.\n4. **If the answer is no, say no once, plainly,** and leave the door open on timing.\n\n## Never\n\n- "I\'ll see what I can do." You either can or you cannot.\n- Apologising for the price. It reads as agreement.\n- Discounting because someone paused. Silence is not an objection.',
  },
  {
    slug: 'how-we-write-follow-ups',
    name: 'How we write follow-ups',
    summary: "Make every follow-up match your team's structure, length, and sign-off.",
    category: 'sales',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: How we write follow-ups\n\nAsk me before you create anything:\n- Sign off as\n- Length\n- Subject line\n- Never say\n\n# How we write follow-ups\n\nFill in the four lines below once. Every follow-up you write anywhere — after a meeting, after a\nquote, after silence — is written this way from then on.\n\n```\nSign off as        <name, and the exact sign-off line>\nLength             <how many sentences before it is too long>\nSubject line       <reply in thread, or a fresh subject in this shape>\nNever say          <the phrases this workspace does not use>\n```\n\n## The shape of a follow-up\n\n1. **One line that proves you were there.** Something specific they said. Not "great to connect".\n2. **The thing you owe them, or the thing you need.** Exactly one. Two asks get zero answers.\n3. **A date.** "By Thursday" beats "at your convenience" every time, because it lets them say no.\n\nThat is the whole email. No recap paragraph — they were in the meeting.\n\n## Rules\n\n- Reply in the existing thread unless there is no thread.\n- Match their formality, not your own. If they write one-liners, write one-liners.\n- Never open with an apology for following up. You are not sorry and it invites a no.\n- Never send a third follow-up without saying it is the last one.\n- If nothing has changed since the last message, do not send one. Silence is information.',
  },
  {
    slug: 'keep-the-crm-matching-my-inbox',
    name: 'Keep the CRM matching my inbox',
    summary: 'Move deals when the conversation moves, so Friday tidying stops.',
    category: 'sales',
    kind: 'task',
    when_line: 'Every evening',
    app_aliases: ['Gmail', 'HubSpot'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Keep the CRM matching my inbox\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Gmail: The conversations it reads.\n- HubSpot: The records it keeps in step.\n\nAsk me before you create anything:\n- Which pipeline\n- Whose mail it reads\n\nIt should run:\n- on the schedule `0 18 * * 1-5` (every evening) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Keep the CRM matching my inbox\n\n## What to do\n\n1. For every open deal, find the most recent human message in either direction.\n2. Update last-contacted from that message. Automated receipts and out-of-offices do not count.\n3. Move a stage only when the thread says so in words. A reply is not a stage change.\n4. List the deals with no human contact for longer than their stage allows.\n\n## Rules\n\n- Never create a deal. Surfacing an unrecorded conversation is a suggestion, not an insert.\n- Never move a deal backwards without saying which message did it.',
  },
  {
    slug: 'keep-the-pipeline-tidy',
    name: 'Keep the pipeline tidy',
    summary: 'Surface the deals with no next step before the forecast uses them.',
    category: 'sales',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['HubSpot', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Keep the pipeline tidy\n\nIt needs these connections — check them, and help me connect any that are missing:\n- HubSpot: The pipeline it audits.\n- Slack (optional): Where each owner gets their own list.\n\nAsk me before you create anything:\n- Which pipeline\n- Where each owner is messaged\n\nIt should run:\n- on the schedule `0 9 * * FRI` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Keep the pipeline tidy\n\n## What to do\n\n1. Pull every open deal. For each, check: is there a next step, is there a close date, when was the last human contact.\n2. Flag a deal when any two of those three are missing or stale for its stage.\n3. Group by owner and send each person only their own list, sorted by value.\n\n## Rules\n\n- Never post one combined list into a shared channel. It reads as a scoreboard and gets muted.\n- If nobody has anything stale, send nothing. A weekly message that is usually empty gets ignored when it is not.',
  },
  {
    slug: 'keep-the-supplier-list-current',
    name: 'Keep the supplier list current',
    summary: 'Check prices, contacts, and lead times against what suppliers sent.',
    category: 'operations',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Google Sheets', 'Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Keep the supplier list current\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Sheets: The supplier list it maintains.\n- Gmail: The correspondence it checks against.\n\nAsk me before you create anything:\n- The supplier list\n- Which mailbox to check against\n\nIt should run:\n- on the schedule `0 9 1 * *` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Keep the supplier list current\n\n## What to do\n\n1. For each supplier, find the most recent invoice and the most recent thread.\n2. Compare price, contact and lead time against the list.\n3. Update what has drifted. Write the old value and the source into an audit column.\n\n## Rules\n\n- Never update from a quote. Only an invoice or an explicit written statement counts.\n- A contact who has not replied in ninety days is flagged, not deleted.',
  },
  {
    slug: 'onboard-a-new-starter',
    name: 'Onboard a new starter',
    summary: 'Start accounts, kit, meetings, and paperwork the day the contract is signed.',
    category: 'operations',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Notion', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Onboard a new starter\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Notion: The checklist it runs.\n- Slack: Where it asks each owner for their part.\n\nAsk me before you create anything:\n- Your onboarding checklist\n- Where each owner is asked\n\nIt should run:\n- on request, whenever I ask\n- on the schedule `0 9 * * MON` (a schedule) — confirm the time and timezone with me first\n\n# Onboard a new starter\n\n## What to do\n\n1. Read the onboarding checklist for the role. If there is not one for that role, use the general one and say so.\n2. Group the items by who provides them. Message each owner once, with their own list and the start date.\n3. Track completion. Re-ask only for what is still outstanding, and only once a week.\n\n## Rules\n\n- Never create accounts or grant access. Requesting is the job.\n- Never share salary, contract terms or personal details in a channel.',
  },
  {
    slug: 'our-escalation-rules',
    name: 'Our escalation rules',
    summary: 'Say what stops being handled quietly, and who it goes to.',
    category: 'support',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: Our escalation rules\n\nAsk me before you create anything:\n- Who gets an escalation\n- How fast it must reach them\n- What never waits\n\n# Our escalation rules\n\n## Fill this in\n\n```\nEscalate immediately   <what cannot wait an hour>\nEscalate same day      <what cannot wait overnight>\nNever escalate         <what looks urgent and is not>\nWho                    <the named person for each, and their backup>\n```\n\n## The rule underneath\n\nEscalate on **irreversibility**, not on volume. Something quiet that cannot be undone outranks something loud that can. Data loss, money leaving, a public statement, a legal threat: these go immediately, whatever tone they arrived in.\n\n## And\n\nA false alarm is cheaper than a late one. Nobody is ever criticised here for raising something that turned out to be fine.',
  },
  {
    slug: 'our-pricing-and-discount-rules',
    name: 'Our pricing and discount rules',
    summary: 'Keep every number that reaches a customer inside your own rules.',
    category: 'finance',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: Our pricing and discount rules\n\nAsk me before you create anything:\n- Your list prices\n- The lowest you go\n- Who approves more than that\n- Never say\n\n# Our pricing and discount rules\n\nFill this in once. Anything that puts a number in front of a customer reads it first.\n\n```\nList price        <the number, and what it includes>\nUnit              <per what: seat, month, event, hour, head>\nMinimum           <the smallest job worth doing, and why>\nDiscount you may  <the discount that needs nobody\'s permission>\nDiscount you may not <where you stop and ask>\nNever included    <the things people assume are included>\n```\n\n## Rules that do not bend\n\n- **Never quote a number that is not in this file.** If the situation is not covered, say the\n  price needs a person and stop. A wrong number said confidently is a refund.\n- **A discount always has a reason and an expiry.** "10% because you\'re booking three" is a\n  price. "10% off" is a leak.\n- **Never discount to close.** If the only reason for the discount is that they hesitated, the\n  answer is no.\n- **Say what is not included, before they ask.** The gap between what they assumed and what they\n  bought is where every bad review comes from.\n\n## When someone asks for "your best price"\n\nGive the list price and the one discount they qualify for. Do not open a negotiation, do not\ninvent a tier, and do not say "let me see what I can do".',
  },
  {
    slug: 'prepare-the-vat-return-pack',
    name: 'Prepare the VAT return pack',
    summary: 'Assemble the return, reconciled, with the odd entries flagged.',
    category: 'finance',
    kind: 'task',
    when_line: 'Each quarter',
    app_aliases: ['Xero'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Prepare the VAT return pack\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Xero: The ledger the pack is built from.\n\nAsk me before you create anything:\n- The VAT period\n- Where the pack is written\n\nIt should run:\n- on the schedule `0 9 1 1,4,7,10 *` (each quarter) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Prepare the VAT return pack\n\n## What to do\n\n1. Pull every transaction in the period.\n2. Reconcile the totals. If they do not reconcile, stop and report the gap.\n3. Flag: missing documents, reverse charges, mixed-rate entries, anything coded differently from the same supplier last quarter.\n4. Assemble the pack with the flagged list on the front page.\n\n## Rules\n\n- Never change a code. Flagging is the whole job.\n- This prepares a pack. A person files the return.',
  },
  {
    slug: 'qualify-inbound-leads',
    name: 'Qualify inbound leads',
    summary: 'Score every form fill against who you sell to, with the reason.',
    category: 'sales',
    kind: 'task',
    when_line: 'When a form comes in',
    app_aliases: ['HubSpot', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Qualify inbound leads\n\nIt needs these connections — check them, and help me connect any that are missing:\n- HubSpot: Where the lead and its score live.\n- Slack (optional): Where the good ones get announced.\n\nAsk me before you create anything:\n- Where the form arrives\n- Where the good ones are announced\n\nIt should run:\n- when a form comes in — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Qualify inbound leads\n\n## What to do\n\n1. Read the submission. Work out the company behind the email domain.\n2. Score it against the workspace definition of a good customer. If that has not been taught yet, ask for it once and stop guessing.\n3. Write one sentence of reason beside the score. The reason is the output; the score is just sorting.\n4. Route: the top band to a person today, the middle band to the nurture list, the bottom band closed with the reason attached.\n\n## Rules\n\n- Never bin something silently. A closed lead carries the line that closed it.\n- A free-mail domain is not a disqualification on its own. Plenty of owners use one.',
  },
  {
    slug: 'quote-a-wedding-from-an-email-enquiry',
    name: 'Quote a wedding from an email enquiry',
    summary: 'Price an enquiry off your rate card and leave a draft quote.',
    category: 'events',
    kind: 'task',
    when_line: 'When an enquiry lands',
    app_aliases: ['Gmail', 'Google Sheets'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Quote a wedding from an email enquiry\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Gmail: The enquiries it reads and where the draft is left.\n- Google Sheets: The rate card and the availability calendar.\n\nAsk me before you create anything:\n- Your rate card\n- The enquiry mailbox\n\nIt should run:\n- when an enquiry lands — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Quote a wedding from an email enquiry\n\n## What to do\n\n1. Read the enquiry for: date, headcount, ceremony or reception or both, and anything named as essential.\n2. Check the date. If it is taken, reply with the nearest two that are not, and stop.\n3. Price line by line from the rate card. Anything not on the card is left off and named as "to confirm".\n4. Leave the quote as a draft reply in the thread.\n\n## Rules\n\n- Never invent a price. An item not on the card is a question, not a number.\n- If the workspace has taught you its pricing and discount rules, that wins over anything here.\n- Never send. A wedding quote goes out with a human behind it.',
  },
  {
    slug: 'research-a-company-before-a-call',
    name: 'Research a company before a call',
    summary: 'Get a concise company brief before each external meeting.',
    category: 'sales',
    kind: 'task',
    when_line: 'Before each meeting',
    app_aliases: ['Google Calendar', 'Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Research a company before a call\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Calendar: The meetings it reads and the timing it works from.\n- Gmail: Where the brief lands.\n\nAsk me before you create anything:\n- How long before the meeting\n- Where the brief lands\n\nIt should run:\n- before each meeting — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Research a company before a call\n\n## What to do\n\n1. Take the next external meeting from the calendar. External means at least one attendee outside the workspace domain.\n2. Find the last thread with any of those attendees. Whatever was promised or left open there is the top of the brief.\n3. Find what changed at their company in the last six months: a hire, a launch, a raise, a move. Date everything.\n4. Write one page: who is in the room, what is open from last time, what changed, and three questions worth asking.\n\n## Rules\n\n- Everything on the page has a source and a date. No adjectives from their homepage.\n- If you found nothing worth saying, say "nothing has changed since your last call" and stop. A padded brief gets skimmed once and then never opened again.\n- Send it to the meeting owner only. Never to the attendees.',
  },
  {
    slug: 'send-the-weekly-cash-position',
    name: 'Send the weekly cash position',
    summary: 'Share balances, commitments, and genuinely free cash.',
    category: 'finance',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Xero', 'Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Send the weekly cash position\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Xero: Balances and commitments.\n- Gmail: Where the note goes.\n\nAsk me before you create anything:\n- Which accounts to include\n- Who the note goes to\n\nIt should run:\n- on the schedule `0 8 * * MON` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Send the weekly cash position\n\n## What to do\n\n1. Read current balances across accounts.\n2. Subtract everything committed in the next fortnight: bills due, payroll, standing commitments.\n3. Add expected receipts only where an invoice exists and is not yet overdue.\n4. Report the three numbers and name the single largest outgoing.\n\n## Rules\n\n- An overdue invoice is not expected income. Move it out.\n- Never project further than the ledger supports. Two weeks is the horizon.',
  },
  {
    slug: 'sort-out-my-inbox',
    name: 'Sort out my inbox',
    summary: 'Answer what it can, archive the noise, and leave you what needs a person.',
    category: 'operations',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Gmail'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Sort out my inbox\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Gmail: The inbox it reads and replies from.\n\nAsk me before you create anything:\n- The mailbox it reads\n\nIt should run:\n- on the schedule `30 7 * * *` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Sort out my inbox\n\nRead everything that arrived since you last ran. Put each message in exactly one of three piles,\nthen act on the piles in order.\n\n## The three piles\n\n**Answer it.** You know the answer, the answer does not commit anyone to anything, and being\nwrong would be embarrassing rather than expensive. Scheduling, "yes we received it", "here is the\nlink", "that is Sarah, copying her in". Reply, keep it to three sentences, sign off the way the\nrest of the thread signs off.\n\n**Ask them.** Everything that commits money, a date, a promise, a person, or an apology. Do not\nreply. Draft nothing. Put it on the list.\n\n**Neither.** Newsletters, receipts, calendar noise, notifications. Archive silently and never\nmention them again.\n\n## The list you hand back\n\nOne line per item, hardest first. Each line is: who, what they want, and what happens if you do\nnothing this week. No summaries of summaries. If the list is longer than seven items, you have\nput things in the wrong pile — go back and re-sort.\n\n## Rules that do not bend\n\n- Never send anything to a recipient who is not already on the thread.\n- Never agree to a date, a price or a scope on someone\'s behalf.\n- If a message is angry, it is always "ask them", even when the answer is obvious.\n- If you are unsure which pile something belongs in, it is "ask them".',
  },
  {
    slug: 'spreadsheet-to-clean-crm-import',
    name: 'Spreadsheet to clean CRM import',
    summary: 'De-duplicate an exported list and match it to what you already have.',
    category: 'sales',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Google Sheets', 'HubSpot'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Spreadsheet to clean CRM import\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Sheets: The list it cleans.\n- HubSpot: What it matches against.\n\nAsk me before you create anything:\n- The sheet to clean\n- What counts as a duplicate\n\nIt should run:\n- on request, whenever I ask\n\n# Spreadsheet to clean CRM import\n\n## What to do\n\n1. Normalise: trim, case, strip protocol and www from domains, split full names.\n2. De-duplicate within the sheet. Match on root domain, then on normalised company name.\n3. Match against the CRM. Write the matched record id into an `existing_record` column.\n4. Split into three tabs: `import`, `update`, `undecided`. Never merge them.\n\n## Rules\n\n- Never write into the CRM. This produces a file; a person runs the import.\n- Anything ambiguous goes to `undecided` with the reason. A wrong merge is unpickable.',
  },
  {
    slug: 'triage-support-tickets',
    name: 'Triage support tickets',
    summary: 'Sort new tickets by what leaving them will cost.',
    category: 'support',
    kind: 'task',
    when_line: 'When a ticket arrives',
    app_aliases: ['Zendesk', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Triage support tickets\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Zendesk: The queue it reads and tags.\n- Slack (optional): Where the ones that cannot wait get raised.\n\nAsk me before you create anything:\n- Which queue it reads\n- Where urgent ones are raised\n\nIt should run:\n- when a ticket arrives — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on the schedule `0 8 * * 1-5` (every weekday morning) — confirm the time and timezone with me first\n\n# Triage support tickets\n\n## What to do\n\n1. Read each new ticket. Decide what it is: broken, confused, asking for something new, or angry.\n2. Check whether the same thing has come in before today. Three of the same is an incident, not three tickets.\n3. Prioritise by cost of delay: money at risk, then people blocked, then annoyance.\n4. Raise anything that cannot wait immediately. Everything else goes in the sorted queue.\n\n## Rules\n\n- Never close a ticket.\n- "Angry" is a routing decision, not a priority. It goes to a person, fast, whatever the severity.',
  },
  {
    slug: 'turn-meeting-notes-into-actions',
    name: 'Turn meeting notes into actions',
    summary: 'Create owned, dated actions from saved meeting notes.',
    category: 'operations',
    kind: 'task',
    when_line: 'When notes are saved',
    app_aliases: ['Google Drive', 'Notion'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Turn meeting notes into actions\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Drive: The notes it reads.\n- Notion: Where the actions are created.\n\nAsk me before you create anything:\n- The notes folder\n- Where the actions are created\n\nIt should run:\n- when notes are saved — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Turn meeting notes into actions\n\n## What to do\n\n1. Read the notes. Find sentences where a specific person committed to a specific thing.\n2. Create one tracked item per commitment: what, who, by when.\n3. List anything that sounded like an action but had no owner, for a person to assign.\n\n## Rules\n\n- "We should" is not an action. Somebody has to have said they would.\n- Never assign to a group. An action with two owners has none.\n- Never invent a date. No date means it goes on the list for a human.',
  },
  {
    slug: 'turn-receipts-into-expense-entries',
    name: 'Turn receipts into expense entries',
    summary: 'Turn a photo or a PDF receipt into a coded expense entry.',
    category: 'finance',
    kind: 'task',
    when_line: 'When a receipt arrives',
    app_aliases: ['Dext', 'Xero'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Turn receipts into expense entries\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Dext: Where receipts land.\n- Xero: Where the entry is created.\n\nAsk me before you create anything:\n- Where receipts arrive\n- Your coding rules\n\nIt should run:\n- when a receipt arrives — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Turn receipts into expense entries\n\n## What to do\n\n1. Read supplier, date, gross, tax and currency off the receipt.\n2. Find how this supplier was coded last time and use that. If there is no last time, leave the code blank.\n3. Create the entry with the image attached.\n\n## Rules\n\n- If the total and the tax do not reconcile, do not create the entry. Hand it back.\n- Never infer a VAT rate. Either it is on the receipt or the field stays empty.\n- A blurry receipt is a human job. Say so and move on.',
  },
  {
    slug: 'venue-enquiry-to-proposal-pdf',
    name: 'Venue enquiry to proposal PDF',
    summary: 'Turn an enquiry into a proposal with your photographs and prices.',
    category: 'events',
    kind: 'task',
    when_line: 'When an enquiry lands',
    app_aliases: ['Gmail', 'Google Drive'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Venue enquiry to proposal PDF\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Gmail: The enquiry and where the draft goes.\n- Google Drive: The photographs, floor plans and the template.\n\nAsk me before you create anything:\n- Your photograph folder\n- Your proposal template\n\nIt should run:\n- when an enquiry lands — if you cannot listen for that event yet, say so and offer me the closest schedule instead\n- on request, whenever I ask\n\n# Venue enquiry to proposal PDF\n\n## What to do\n\n1. Read the enquiry for date, headcount, and the shape of the event.\n2. Pick the spaces that fit, and only those. A proposal offering the wrong room reads as a mailshot.\n3. Assemble from the template: the spaces, the photographs for those spaces, the floor plan, the price.\n4. Attach the PDF to a draft reply.\n\n## Rules\n\n- Never use an image of a space that is not in the proposal.\n- Anything not on the rate card is marked "to confirm", never priced.\n- Never send. Someone checks the number first.',
  },
  {
    slug: 'watch-the-jobs-board-for-competitor-hires',
    name: 'Watch the jobs board for competitor hires',
    summary: 'See what competitors are hiring for, which is what they will build.',
    category: 'operations',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Watch the jobs board for competitor hires\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Slack: Where the note is posted.\n\nAsk me before you create anything:\n- Which competitors to watch\n- Where the note is posted\n\nIt should run:\n- on the schedule `0 9 * * MON` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Watch the jobs board for competitor hires\n\n## What to do\n\n1. Check the public careers page of each competitor on the list.\n2. Compare against last week. Report only what is new or gone.\n3. Where three or more roles point the same way, say what that suggests they are building — and mark it as a reading, not a fact.\n\n## Rules\n\n- Public pages only.\n- Never report a single junior opening. One hire is noise.\n- A week with no change gets one line saying so.',
  },
  {
    slug: 'wedding-quote-line-items-and-margins',
    name: 'Wedding quote line items and margins',
    summary: 'Hold your line-item order and your margin floor on every quote.',
    category: 'events',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: Wedding quote line items and margins\n\nAsk me before you create anything:\n- Your line item order\n- Your margin floor\n- Never bundled in\n\n# Wedding quote line items and margins\n\n## Fill this in\n\n```\nLine items       <in the order they appear on every quote>\nMargin floor     <per item — venue, catering, staffing, hire, coordination>\nNever bundled    <the things people assume come free>\nOvertime         <the rate, and after which hour it starts>\n```\n\n## How to use it\n\n- Build every quote in the fixed order. A quote that reorders items cannot be compared to the last one.\n- Check each line against its own margin floor. One blanket percentage hides the item that is losing money.\n- Anything under **Never bundled** appears on the quote as a priced line, even at a small number. Removing it is a negotiation; omitting it is a gift.\n\n## The part people skip\n\nStaffing overtime. It is the line that turns a good margin into a bad one, and it is the line nobody quotes because the conversation is awkward on the day. Put it on the quote.',
  },
  {
    slug: 'weekly-revenue-pulse-to-slack',
    name: 'Weekly revenue pulse to Slack',
    summary: 'Post the four numbers that matter in the channel every Monday.',
    category: 'finance',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Stripe', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Weekly revenue pulse to Slack\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Stripe: Where the numbers come from.\n- Slack: The channel it posts in.\n\nAsk me before you create anything:\n- Which four numbers\n- The channel it posts in\n\nIt should run:\n- on the schedule `0 9 * * MON` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Weekly revenue pulse to Slack\n\n## What to do\n\n1. Pull last week and the week before: new revenue, churned revenue, net, and cash collected.\n2. Post the four numbers with the change against the prior week.\n3. Add one line naming the largest single mover and what it was.\n\n## Rules\n\n- Four numbers. Adding a fifth is how this becomes a report nobody reads.\n- If nothing moved more than a few percent, say so in one line and stop.\n- Never annualise a weekly number.',
  },
  {
    slug: 'what-a-good-support-reply-looks-like',
    name: 'What a good support reply looks like',
    summary: 'Shape every reply so it ends the ticket instead of starting a thread.',
    category: 'support',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: What a good support reply looks like\n\nAsk me before you create anything:\n- Sign off as\n- Length\n- Never say\n\n# What a good support reply looks like\n\n## The shape\n\n1. **The answer.** First line. Not "thanks for reaching out".\n2. **What to do next,** if anything.\n3. **Why it happened,** only if they asked or it was our fault.\n4. **The apology,** only when it was ours. An apology for their own mistake is condescending.\n\n## Never say\n\n- "As per our policy." Say the thing the policy says.\n- "The team is looking into it." Name what happens and roughly when.\n- "Unfortunately." It signals a no before the sentence starts and they stop reading.\n\n## When you do not know\n\nSay you do not know, say who does, say when they will reply. That closes more tickets than a guess.',
  },
  {
    slug: 'who-our-good-customers-look-like',
    name: 'Who our good customers look like',
    summary: 'Teach it your book once, and every task that touches companies gets sharper.',
    category: 'sales',
    kind: 'skill',
    when_line: 'On request',
    app_aliases: [],
    setup_message:
      'Learn this skill for our workspace. Ask me for anything it leaves blank, then save it.\n\nTemplate: Who our good customers look like\n\nAsk me before you create anything:\n- Your five best customers\n- What they have in common\n- Who you never sell to\n\n# Who our good customers look like\n\nThis is the workspace\'s own definition of a good customer. Fill it in once; every job that\ntouches companies gets sharper.\n\n## Fill this in\n\nReplace each line. Keep it short — this gets read on every relevant turn, so length costs you.\n\n```\nBest fit          <size band> · <what makes them ours> · <where>\nSigns off         <the two or three titles who actually decide>\nWorth a call when <the events that mean now, not someday>\nNot for us        <who to cut, and the one-line reason>\n```\n\n`references/filled-example.md` has one filled in, to copy the shape from.\n\n## How to use it\n\n- When you rank a list, rank by fit against **Best fit**, not by size and not alphabetically.\n- When you cut something, say which **Not for us** line cut it. A cut without a reason reads as a\n  mistake and someone will put it back.\n- When you write a "why now", prefer the events under **Worth a call when**. Anything else is a\n  fact about the company, not a reason to call it.\n- When a company matches nothing here, say so plainly rather than stretching a match.\n\n## The part people skip\n\n**Not for us** does most of the work. Knowing who you are not for is what stops a list being\nnoise. Write at least two lines there, each with the reason — "under 50 staff: nobody owns the\nprocess yet" is useful; "too small" is not.',
  },
  {
    slug: 'write-a-first-touch-sequence',
    name: 'Write a first-touch sequence',
    summary: 'Draft a focused outbound sequence from your lead sheet.',
    category: 'sales',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Google Sheets'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Write a first-touch sequence\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Google Sheets: The segment it reads.\n\nAsk me before you create anything:\n- The segment sheet\n- Where the drafts are written\n\nIt should run:\n- on request, whenever I ask\n\n# Write a first-touch sequence\n\n## What to do\n\n1. Read the segment. Find the one situation these companies are genuinely in together.\n2. If they share nothing but a filter you applied, say so and stop. A sequence to a fake segment is worse than no sequence.\n3. Write three emails: the observation, the proof, the last one. Each is under seven sentences.\n\n## Rules\n\n- The third email says it is the last one.\n- No merge fields beyond first name and company. Anything else breaks in public.\n- If the workspace has taught you how it writes follow-ups, that wins.',
  },
  {
    slug: 'write-the-weekly-support-digest',
    name: 'Write the weekly support digest',
    summary: 'Post what customers actually complained about, in cost order.',
    category: 'support',
    kind: 'task',
    when_line: 'On request',
    app_aliases: ['Zendesk', 'Slack'],
    setup_message:
      'Set up this task for me. Ask me for the details you need, then schedule it.\n\nTemplate: Write the weekly support digest\n\nIt needs these connections — check them, and help me connect any that are missing:\n- Zendesk: The week it summarises.\n- Slack: Where the digest is posted.\n\nAsk me before you create anything:\n- Which queue it reads\n- Where the digest is posted\n\nIt should run:\n- on the schedule `0 16 * * FRI` (a schedule) — confirm the time and timezone with me first\n- on request, whenever I ask\n\n# Write the weekly support digest\n\n## What to do\n\n1. Read the week. Group into themes by what the customer was trying to do.\n2. For each theme: the count, one verbatim customer sentence, and what would make it stop.\n3. Order by count times how annoyed people were, not by count alone.\n\n## Rules\n\n- Quote customers verbatim. A paraphrase loses the thing that makes someone act.\n- Five themes maximum. Anything longer is a spreadsheet, not a digest.\n- A quiet week gets three lines.',
  },
];
