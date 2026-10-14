---
name: quote-a-wedding-from-an-email-enquiry
description: "Use when a wedding enquiry arrives by email: read the date, headcount and requirements out of it, price it against the workspace rate card, and leave a draft quote."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Quote a wedding from an email enquiry
  author: Alfera
  triggers:
    - quote this enquiry
    - price this wedding
    - draft a quote
allowed-tools:
  - gmail
  - google_sheets
---

# Quote a wedding from an email enquiry

## What to do

1. Read the enquiry for: date, headcount, ceremony or reception or both, and anything named as essential.
2. Check the date. If it is taken, reply with the nearest two that are not, and stop.
3. Price line by line from the rate card. Anything not on the card is left off and named as "to confirm".
4. Leave the quote as a draft reply in the thread.

## Rules

- Never invent a price. An item not on the card is a question, not a number.
- If the workspace has taught you its pricing and discount rules, that wins over anything here.
- Never send. A wedding quote goes out with a human behind it.
