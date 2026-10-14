---
name: build-a-seating-plan-from-rsvps
description: "Use to turn an RSVP list into a seating plan: respect the household groupings, the dietary notes and the \"please not next to\" instructions."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Build a seating plan from RSVPs
  author: Alfera
  triggers:
    - build the seating plan
    - sort the tables
    - who sits where
allowed-tools:
  - google_sheets
---

# Build a seating plan from RSVPs

## What to do

1. Read the RSVP list. Group by household first: nobody is separated from who they arrived with.
2. Apply every explicit constraint in the notes column. These are hard, not preferences.
3. Fill tables to the stated capacity, keeping groups whole where you can.
4. Write the plan to its own tab, with dietary requirements in a column the kitchen reads.

## Rules

- A "please not next to" is never traded off for a neater table count.
- If a constraint cannot be met, say which one and why. Never break it silently.
