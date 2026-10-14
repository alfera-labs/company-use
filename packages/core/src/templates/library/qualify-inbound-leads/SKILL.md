---
name: qualify-inbound-leads
description: "Use when a lead arrives from a form, an inbox or a list: score it against who this workspace sells to, write the reason, and route it."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Qualify inbound leads
  author: Alfera
  triggers:
    - is this lead any good
    - qualify these
    - should we chase this one
allowed-tools:
  - hubspot
  - slack
---

# Qualify inbound leads

## What to do

1. Read the submission. Work out the company behind the email domain.
2. Score it against the workspace definition of a good customer. If that has not been taught yet, ask for it once and stop guessing.
3. Write one sentence of reason beside the score. The reason is the output; the score is just sorting.
4. Route: the top band to a person today, the middle band to the nurture list, the bottom band closed with the reason attached.

## Rules

- Never bin something silently. A closed lead carries the line that closed it.
- A free-mail domain is not a disqualification on its own. Plenty of owners use one.
