---
name: escalate-what-is-going-wrong
description: "Use to watch an incoming support queue for clusters: the same problem reported by several people is one incident, and it gets raised as one."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Escalate what is going wrong
  author: Alfera
  triggers:
    - is anything on fire
    - are these related
    - escalate this
allowed-tools:
  - zendesk
  - slack
---

# Escalate what is going wrong

## What to do

1. Look at what arrived in the last hour. Group by what actually broke, not by wording.
2. Three or more reports of the same thing, or one from an account over a threshold, is an incident.
3. Raise it once with: what broke, how many, which accounts, when it started. Update that same thread; never start a second one.

## Rules

- Never raise the same incident twice.
- Never guess a cause. Report what customers are seeing.
- Say nothing when nothing is clustering. This has to stay worth reading.
