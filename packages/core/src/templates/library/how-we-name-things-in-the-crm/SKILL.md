---
name: how-we-name-things-in-the-crm
description: "Use before creating or renaming any CRM record: companies, deals, contacts. Read this so search keeps working and duplicates stop appearing."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: How we name things in the CRM
  author: Alfera
  triggers:
    - what should I call this deal
    - name this record
    - is this a duplicate
---

# How we name things in the CRM

## Fill this in

```
Company name   <the trading name, no Ltd/Inc, no punctuation>
Deal name      <company · what · period>
Matched on     <root domain first, then normalised name>
Never in a name <legal suffix, region, stage, owner initials>
```

## Why the deal shape

Naming a deal `company · what · period` means an alphabetical list is also a useful list. Anything with a stage or an owner in the name goes stale the moment either changes, and then the name is a lie.

## Duplicates

Match on root domain before anything else. "Acme", "ACME Ltd" and "Acme Group" are one record if they share a domain and three if you match on name.
