---
name: wedding-quote-line-items-and-margins
description: "Use before building or checking any event quote: the line items this workspace prices, the order they appear in, the margin each carries, and what is never given away."
license: Apache-2.0
compatibility: ">=1.0"
metadata:
  display_name: Wedding quote line items and margins
  author: Alfera
  triggers:
    - price this wedding
    - what margin on this
    - build the quote lines
---

# Wedding quote line items and margins

## Fill this in

```
Line items       <in the order they appear on every quote>
Margin floor     <per item — venue, catering, staffing, hire, coordination>
Never bundled    <the things people assume come free>
Overtime         <the rate, and after which hour it starts>
```

## How to use it

- Build every quote in the fixed order. A quote that reorders items cannot be compared to the last one.
- Check each line against its own margin floor. One blanket percentage hides the item that is losing money.
- Anything under **Never bundled** appears on the quote as a priced line, even at a small number. Removing it is a negotiation; omitting it is a gift.

## The part people skip

Staffing overtime. It is the line that turns a good margin into a bad one, and it is the line nobody quotes because the conversation is awkward on the day. Put it on the quote.
