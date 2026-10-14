---
name: chase-missing-receipts-from-the-team
description: "Use to find card transactions with no receipt attached and chase the person who made them, individually."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Chase missing receipts from the team
  author: Alfera
  triggers:
    - chase the receipts
    - who has not submitted expenses
    - missing receipts
allowed-tools:
  - xero
  - slack
---

# Chase missing receipts from the team

## What to do

1. Find card transactions older than seven days with no receipt attached.
2. Group by cardholder. One message per person, listing everything they owe.
3. At thirty days, list the outstanding ones to the finance owner. Once, not weekly.

## Rules

- Never post a list of names into a shared channel.
- Never chase the same transaction more than once a week.
