---
name: keep-the-crm-matching-my-inbox
description: "Use to keep CRM records in step with what is actually happening in email: update stages, log the last contact, and flag the deals nobody has replied to."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Keep the CRM matching my inbox
  author: Alfera
  triggers:
    - update the crm
    - is the pipeline accurate
    - log these emails
allowed-tools:
  - gmail
  - hubspot
---

# Keep the CRM matching my inbox

## What to do

1. For every open deal, find the most recent human message in either direction.
2. Update last-contacted from that message. Automated receipts and out-of-offices do not count.
3. Move a stage only when the thread says so in words. A reply is not a stage change.
4. List the deals with no human contact for longer than their stage allows.

## Rules

- Never create a deal. Surfacing an unrecorded conversation is a suggestion, not an insert.
- Never move a deal backwards without saying which message did it.
