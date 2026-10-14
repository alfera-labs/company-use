---
name: spreadsheet-to-clean-crm-import
description: "Use when a spreadsheet of companies or people needs to become CRM records: normalise it, match it against what already exists, and produce a file that will not duplicate."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Spreadsheet to clean CRM import
  author: Alfera
  triggers:
    - import this list
    - clean this spreadsheet
    - will this duplicate
allowed-tools:
  - google_sheets
  - hubspot
---

# Spreadsheet to clean CRM import

## What to do

1. Normalise: trim, case, strip protocol and www from domains, split full names.
2. De-duplicate within the sheet. Match on root domain, then on normalised company name.
3. Match against the CRM. Write the matched record id into an `existing_record` column.
4. Split into three tabs: `import`, `update`, `undecided`. Never merge them.

## Rules

- Never write into the CRM. This produces a file; a person runs the import.
- Anything ambiguous goes to `undecided` with the reason. A wrong merge is unpickable.
