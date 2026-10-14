---
name: answer-the-repeat-questions
description: "Use to answer the support questions that have a settled answer, in this workspace's words, and leave everything else untouched."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Answer the repeat questions
  author: Alfera
  triggers:
    - answer the easy tickets
    - clear the repeats
    - reply to the common questions
allowed-tools:
  - zendesk
---

# Answer the repeat questions

## What to do

1. Read the ticket. Find whether this exact question has a settled answer in past replies or the help centre.
2. If it does, answer it in the same words this workspace already uses.
3. If it does not, leave the ticket untouched and move on.

## Rules

- Never answer anything touching a refund, a price, an account deletion, or a mistake made by us.
- Never write a new answer. If the answer does not exist yet, that is a human decision to make once.
- One reply per ticket, then stop.
