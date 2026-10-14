---
name: turn-meeting-notes-into-actions
description: "Use after a meeting to extract the actions from the notes and create them where the team actually tracks work, each with an owner and a date."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Turn meeting notes into actions
  author: Alfera
  triggers:
    - pull the actions out
    - what did we commit to
    - create the tasks from these notes
allowed-tools:
  - google_drive
  - notion
---

# Turn meeting notes into actions

## What to do

1. Read the notes. Find sentences where a specific person committed to a specific thing.
2. Create one tracked item per commitment: what, who, by when.
3. List anything that sounded like an action but had no owner, for a person to assign.

## Rules

- "We should" is not an action. Somebody has to have said they would.
- Never assign to a group. An action with two owners has none.
- Never invent a date. No date means it goes on the list for a human.
