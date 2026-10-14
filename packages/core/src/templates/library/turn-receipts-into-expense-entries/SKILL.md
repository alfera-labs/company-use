---
name: turn-receipts-into-expense-entries
description: "Use when a receipt arrives as an image, a PDF or an email: read it, code it the way this workspace codes things, and create the expense entry."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Turn receipts into expense entries
  author: Alfera
  triggers:
    - file this receipt
    - code this expense
    - add this to the books
allowed-tools:
  - dext
  - xero
---

# Turn receipts into expense entries

## What to do

1. Read supplier, date, gross, tax and currency off the receipt.
2. Find how this supplier was coded last time and use that. If there is no last time, leave the code blank.
3. Create the entry with the image attached.

## Rules

- If the total and the tax do not reconcile, do not create the entry. Hand it back.
- Never infer a VAT rate. Either it is on the receipt or the field stays empty.
- A blurry receipt is a human job. Say so and move on.
