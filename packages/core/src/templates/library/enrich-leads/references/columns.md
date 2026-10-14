# The columns it fills, in order

Write these and only these. If a column already has a value the person put there, leave it alone —
they know something you do not.

| Column | What goes in it | If you cannot find it |
|---|---|---|
| `company` | The legal or trading name, as the company writes it | leave the row's original value |
| `domain` | Root domain, no protocol, no www | blank |
| `size_band` | One of: 1-9, 10-49, 50-249, 250-999, 1000+ | blank |
| `sector` | Plain English, two or three words. "Wedding venues", not "NAICS 72131" | blank |
| `country` | Where the head office is, not where the domain is registered | blank |
| `contact_name` | First and last name | blank |
| `contact_title` | Their title as written on their own profile | blank |
| `contact_source` | Where you found them, as a URL | blank |
| `why_now` | One sentence with a date. "Hired a Head of Ops in March 2026." | blank |
| `notes` | Why anything above is blank | required whenever anything is blank |

## Format rules that matter

- Dates in `why_now` are written as a month and a year, never as "recently".
- `size_band` is a band, never a headcount. A headcount you scraped is out of date the day you
  wrote it, and it invites a false sense of precision.
- Nothing in `why_now` is a plan, a rumour or a prediction. It happened, or it does not go in.
