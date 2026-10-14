---
name: our-escalation-rules
description: "Use to decide whether something should be escalated, to whom, and how fast. Read before raising anything, and before deciding not to."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Our escalation rules
  author: Alfera
  triggers:
    - should I escalate this
    - who needs to know
    - is this urgent
---

# Our escalation rules

## Fill this in

```
Escalate immediately   <what cannot wait an hour>
Escalate same day      <what cannot wait overnight>
Never escalate         <what looks urgent and is not>
Who                    <the named person for each, and their backup>
```

## The rule underneath

Escalate on **irreversibility**, not on volume. Something quiet that cannot be undone outranks something loud that can. Data loss, money leaving, a public statement, a legal threat: these go immediately, whatever tone they arrived in.

## And

A false alarm is cheaper than a late one. Nobody is ever criticised here for raising something that turned out to be fine.
