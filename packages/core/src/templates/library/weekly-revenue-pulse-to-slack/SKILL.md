---
name: weekly-revenue-pulse-to-slack
description: "Use to post a short weekly revenue update: the handful of numbers that matter, what changed, and the one thing worth noticing."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Weekly revenue pulse to Slack
  author: Alfera
  triggers:
    - post the weekly numbers
    - revenue update
    - how did last week go
allowed-tools:
  - stripe
  - slack
---

# Weekly revenue pulse to Slack

## What to do

1. Pull last week and the week before: new revenue, churned revenue, net, and cash collected.
2. Post the four numbers with the change against the prior week.
3. Add one line naming the largest single mover and what it was.

## Rules

- Four numbers. Adding a fifth is how this becomes a report nobody reads.
- If nothing moved more than a few percent, say so in one line and stop.
- Never annualise a weekly number.
