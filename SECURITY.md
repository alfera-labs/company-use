# Security policy

## Report a vulnerability

Do not open a public issue. Do not post the details in a discussion or a pull
request.

Use one of these two private channels.

1. **GitHub.** Open the repository's **Security** tab and press **Report a
   vulnerability**. This creates a private advisory that only you and the
   maintainers can read.
2. **Email.** Write to security@alfera.ai. Use the email if you cannot reach
   GitHub, or if you want to send an encrypted message first and ask for a key.

Include what you can:

- The version or the commit you tested.
- The steps to reproduce the problem.
- What an attacker gains.
- Any log line, request, or script that shows the problem.

## What happens next

| When | What we do |
| --- | --- |
| Within 3 working days | We confirm that we received the report. |
| Within 10 working days | We tell you whether we accept the report, and we give you our severity rating. |
| While we work | We keep you updated at least every 14 days. |
| At the fix | We release the patch and credit you, unless you ask us not to. |

## Disclosure window

We ask you to keep the report private for 90 days from the day you send it, or
until we publish the fix, whichever comes first.

We publish a security advisory for every accepted report. If we have not fixed
the problem within 90 days, you are free to publish. Tell us first so we can
warn the people running the software.

## Scope

This policy covers the code in this repository and the container images built
from it. The hosted service at app.alfera.ai is in scope as well.

These are out of scope:

- A finding that needs physical access to a machine you do not own.
- A report from an automated scanner with no proof that the problem is real.
- A weakness in a third-party dependency. Report that to its maintainers, then
  tell us so we can pin or patch.
- Social engineering of our staff or our users.

## Safe harbour

We will not pursue legal action against you for research that follows this
policy. Test against your own installation. Do not read, change, or delete other
people's data. Stop as soon as you have proof, and report it.
