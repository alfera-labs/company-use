---
name: enrich-leads
description: Use when someone gives you a list of companies or domains and wants it turned into something worth acting on — size, sector, the right person to contact, and one honest line on why now. Also use when asked to "enrich this list", "who should I talk to at these", or "find the contacts for these companies".
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Enrich a list of leads
  author: Alfera
  triggers:
    - enrich this list
    - who should I talk to at these companies
    - find the right contact
    - add contacts to this sheet
allowed-tools:
  - browser
  - spreadsheet
---

# Enrich a list of leads

You are given a sheet with one company per row. Fill in the missing columns so that every row
either has a contact and a reason to reach out, or a blank with a note saying why not.

## What to do

1. Read the sheet. The first column holds a company name or a domain; ignore any row where both
   are empty.
2. For each company, find its size band, sector and head-office country. Use the company's own
   site first; fall back to public directories. Never guess a number.
3. Pick one person. Read `references/titles.md` for which job titles count, in priority order.
   If the workspace has taught you who its good customers look like, follow that instead — it is
   more specific than this file and it wins.
4. Write the "why now" from something that actually happened in the last six months: a hire, a
   launch, a funding round, a new location, a system migration. One sentence, with the date.
5. Fill the columns listed in `references/columns.md`, in that order, and nothing else.

## When you cannot find something

Leave the cell blank and put the reason in the `notes` column: "no ops hire found since Jan",
"site is a holding page", "two companies share this name". A blank with a reason is useful. An
invented contact is worse than an empty row, because someone will email it.

## Finishing

Write the rows back in one pass, not one row at a time. Then say how many rows you filled, how
many you left blank, and the single most common reason for the blanks.
