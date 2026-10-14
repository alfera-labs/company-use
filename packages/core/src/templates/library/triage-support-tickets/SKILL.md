---
name: triage-support-tickets
description: "Use to triage an incoming support queue: read each ticket, work out what it actually is, and sort by what leaving it costs."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Triage support tickets
  author: Alfera
  triggers:
    - triage the queue
    - what is urgent in support
    - sort the tickets
allowed-tools:
  - zendesk
  - slack
---

# Triage support tickets

## What to do

1. Read each new ticket. Decide what it is: broken, confused, asking for something new, or angry.
2. Check whether the same thing has come in before today. Three of the same is an incident, not three tickets.
3. Prioritise by cost of delay: money at risk, then people blocked, then annoyance.
4. Raise anything that cannot wait immediately. Everything else goes in the sorted queue.

## Rules

- Never close a ticket.
- "Angry" is a routing decision, not a priority. It goes to a person, fast, whatever the severity.
