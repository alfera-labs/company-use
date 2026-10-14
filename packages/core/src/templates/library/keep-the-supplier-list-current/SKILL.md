---
name: keep-the-supplier-list-current
description: "Use to keep a supplier list honest: check each entry against recent invoices and correspondence, and flag what has drifted."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Keep the supplier list current
  author: Alfera
  triggers:
    - update the supplier list
    - have prices changed
    - check our suppliers
allowed-tools:
  - google_sheets
  - gmail
---

# Keep the supplier list current

## What to do

1. For each supplier, find the most recent invoice and the most recent thread.
2. Compare price, contact and lead time against the list.
3. Update what has drifted. Write the old value and the source into an audit column.

## Rules

- Never update from a quote. Only an invoice or an explicit written statement counts.
- A contact who has not replied in ninety days is flagged, not deleted.
