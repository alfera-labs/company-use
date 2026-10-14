---
name: close-the-month
description: "Use to run a month-end close: walk the checklist, chase the missing pieces from whoever owes them, and report exactly what is still outstanding."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Close the month
  author: Alfera
  triggers:
    - close the month
    - run month end
    - what is outstanding for close
allowed-tools:
  - xero
  - slack
---

# Close the month

## What to do

1. Read the workspace close checklist. If there is not one, ask for it once and stop.
2. For each step, check whether the underlying thing is actually done in the ledger.
3. Chase the named owner of anything missing, individually.
4. Report what is still outstanding, once a day, until nothing is.

## Rules

- A step is done when the ledger says so, not when someone says so.
- Never adjust a figure to make something reconcile.
