---
name: chase-the-final-headcount
description: "Use in the run-up to an event: chase the guests who have not responded, on a schedule that works backwards from the catering deadline."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Chase the final headcount
  author: Alfera
  triggers:
    - chase the rsvps
    - who has not replied
    - final numbers
allowed-tools:
  - google_sheets
  - gmail
---

# Chase the final headcount

## What to do

1. Work out the chase dates backwards from the catering deadline: fourteen days, seven days, three days.
2. On each date, email one person per household that has not replied.
3. Three days out, stop emailing and hand the remaining list over for phone calls.

## Rules

- One email per household. Chasing four people at one address is how you lose a guest.
- A "no" is a reply. Stop chasing immediately.
- Never chase past the deadline. After that the number is the number.
