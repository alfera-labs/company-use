---
name: prepare-the-vat-return-pack
description: "Use to assemble a VAT return pack: pull the period, reconcile it, and flag every entry whose treatment is not obvious."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Prepare the VAT return pack
  author: Alfera
  triggers:
    - prepare the vat return
    - vat pack
    - get the quarter ready
allowed-tools:
  - xero
---

# Prepare the VAT return pack

## What to do

1. Pull every transaction in the period.
2. Reconcile the totals. If they do not reconcile, stop and report the gap.
3. Flag: missing documents, reverse charges, mixed-rate entries, anything coded differently from the same supplier last quarter.
4. Assemble the pack with the flagged list on the front page.

## Rules

- Never change a code. Flagging is the whole job.
- This prepares a pack. A person files the return.
