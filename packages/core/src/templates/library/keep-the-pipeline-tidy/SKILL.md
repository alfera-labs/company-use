---
name: keep-the-pipeline-tidy
description: "Use to audit an open pipeline: find the deals with no next step, no close date, or no recent contact, and put them in front of the person who owns them."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Keep the pipeline tidy
  author: Alfera
  triggers:
    - audit the pipeline
    - which deals are stale
    - clean up the forecast
allowed-tools:
  - hubspot
  - slack
---

# Keep the pipeline tidy

## What to do

1. Pull every open deal. For each, check: is there a next step, is there a close date, when was the last human contact.
2. Flag a deal when any two of those three are missing or stale for its stage.
3. Group by owner and send each person only their own list, sorted by value.

## Rules

- Never post one combined list into a shared channel. It reads as a scoreboard and gets muted.
- If nobody has anything stale, send nothing. A weekly message that is usually empty gets ignored when it is not.
