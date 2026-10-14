---
name: chase-overdue-invoices
description: "Use to chase unpaid invoices: find what is overdue, send the right nudge for how late it is, track replies, and escalate what stops moving."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Chase overdue invoices
  author: Alfera
  triggers:
    - chase the invoices
    - who owes us money
    - send payment reminders
allowed-tools:
  - xero
  - gmail
---

# Chase overdue invoices

## What to do

1. Pull unpaid invoices past their due date. Group them by how late: under 14 days, 14 to 30, over 30.
2. Send the wording for that band to the billing contact on the invoice.
3. Record the chase. Stop the sequence the moment a human replies.
4. Hand back the over-30 list for a person to call.

## Rules

- Never chase an invoice flagged as in dispute or on a payment plan.
- Never chase twice in one week, whatever the age.
- Never name a consequence you cannot follow through on.
