---
name: send-the-weekly-cash-position
description: "Use to report cash position: balances, committed outgoings, expected receipts, and what is genuinely free."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Send the weekly cash position
  author: Alfera
  triggers:
    - what is our cash position
    - how much have we got
    - cash update
allowed-tools:
  - xero
  - gmail
---

# Send the weekly cash position

## What to do

1. Read current balances across accounts.
2. Subtract everything committed in the next fortnight: bills due, payroll, standing commitments.
3. Add expected receipts only where an invoice exists and is not yet overdue.
4. Report the three numbers and name the single largest outgoing.

## Rules

- An overdue invoice is not expected income. Move it out.
- Never project further than the ledger supports. Two weeks is the horizon.
