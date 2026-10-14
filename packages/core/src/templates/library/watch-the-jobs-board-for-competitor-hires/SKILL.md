---
name: watch-the-jobs-board-for-competitor-hires
description: "Use to monitor a named list of competitors' job postings and report what the pattern implies about what they are building."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Watch the jobs board for competitor hires
  author: Alfera
  triggers:
    - what are competitors hiring for
    - watch their jobs page
    - competitor hiring
allowed-tools:
  - slack
---

# Watch the jobs board for competitor hires

## What to do

1. Check the public careers page of each competitor on the list.
2. Compare against last week. Report only what is new or gone.
3. Where three or more roles point the same way, say what that suggests they are building — and mark it as a reading, not a fact.

## Rules

- Public pages only.
- Never report a single junior opening. One hire is noise.
- A week with no change gets one line saying so.
