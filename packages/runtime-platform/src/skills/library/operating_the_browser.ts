import { render_browser_operating_guide } from '@agent-core/browser/browser_operating_guide';
import type { SkillDefinition } from '@runtime-platform/skills/types';

export const operate_the_browser_skill: SkillDefinition = {
  skill_slug: 'operate-the-browser',
  skill_name: 'Operate the browser',
  description:
    'Use for ANY task that involves browsing a website or navigating the web, scraping or extracting data from pages, clicking buttons or links, or filling out and submitting forms — including logins and other multi-step web flows. Loads the full browser operating manual.',
  discovery_hint:
    'Use for ANY web task: browsing a site, scraping or extracting page data, clicking through pages, filling and submitting forms, logging in, and other multi-step web flows.',
  body: [
    '# Operate the browser',
    '',
    'You have a real browser. Use it for browsing websites, scraping or extracting data, clicking through pages, filling and submitting forms, logging in, and any multi-step web flow — instead of answering from memory or declaring the web out of reach.',
    '',
    '## Run the task',
    '- With a `browse` tool: hand it the WHOLE task in one call. Spell out the goal completely — what to find or do, every count, filter, field, and format the user asked for, and what to report back. The sub-agent operates the browser to completion and returns the outcome.',
    '- With only a `browser` tool: drive it yourself, one agent-browser command per call, following the guide below.',
    "- Either way, pursue the user's goal until it is fully achieved and verified. Do not stop at the first obstacle, and do not present partial work as done — if a browse attempt comes back incomplete, refine the task and go again.",
    '',
    '## Sites this workspace has already connected',
    "Before browsing a site, check `authenticated_hosts` on the connections in Current Connections. If the site is listed there, **you are already signed in**: the credential is attached to every request leaving this machine, including the browser's, so just open the page you actually want. There is no login step, no password to ask anyone for, and no sign-in form to fill.",
    'Go straight to the page you actually want. Do not visit the sign-in page to check whether you are signed in — some sites redirect a signed-in visitor to the dashboard and others simply render the form, so it answers nothing.',
    'If a **protected** page hands you a login form, do not try to fill it in. Load the calling-a-connected-app skill and follow what it says about a credential that has stopped working.',
    '',
    '## Derive repeatable website operations',
    '- For a recurring workflow, clicking is discovery only. Turn each repeatable action into an HTTP client instead of teaching future runs to click the same UI forever.',
    "- Run `skills get derive-client` and follow it end to end. That is the CLI's own manual for recording a HAR and writing a client from it — record, identify the real endpoints, extract the request shapes, write the client, and call every function against the live site before you call it done. Read the whole thing before you start recording.",
    '- Apply these three overrides where this workspace differs from the manual:',
    '- OVERRIDE 1 — never write auth material to a file. The manual tells you to persist credentials in three separate places: step 3 (`cookies get --json > cookies.json`), step 4 (auth material "loads from a file or environment variable"), and step 5 ("re-export cookies"). Ignore all three. No cookie, bearer token, CSRF token, or API key goes into a file, an environment variable, or client source — the browser session IS the auth. A credential in a published file is a login to the customer\'s account sitting on their durable volume.',
    "- Check Current Connections FIRST. If the host is listed in a connection's `authenticated_hosts`, the credential is attached at the network edge and the browser is not involved at all: build the client on `workspace-http_request`. It needs no page open, no cookie, and no eval, so it cannot fail the way the browser route can.",
    "- Otherwise, make every call with `agent-browser eval` running `fetch(url, { credentials: 'include' })`. `eval` runs in the current page's origin, so when the browser is not already on the API's origin, `agent-browser open <api-origin>` first — a cross-origin fetch silently drops the session, surfaces as `TypeError: Failed to fetch`, and reads like a wrong endpoint or an expired login when it is neither.",
    '- OVERRIDE 2 — record small, and treat the HAR as disposable rather than a keepsake. `mkdir -p tmp/derived-clients` first, then start the capture with `network har start --content none`: the manual embeds every text response body by default, which bloats the HAR and can crash this sandbox. Read response shapes from a live `agent-browser eval` fetch instead of from the capture. Record to `tmp/derived-clients/<client-slug>.har`, delete it once the client works, and never copy it to `clients/`, `artifacts/`, `logs/`, or any other durable path.',
    '- OVERRIDE 3 — the finished client lives at `tools/<client-slug>/` with a README naming each operation. That directory is durable and is where future runs look first.',
    '- Prove each write with a value you can find again: perform the action with a harmless unique test value at least 8 characters long, then read it back through a call your client did not make — a fresh `agent-browser eval` fetch — and confirm the site returns it. A write you have not read back is not done.',
    '- Cover every repeatable action before processing the remaining items, and prefer the client over clicking once it exists.',
    '- The customer only logs in and describes the workflow. Never ask them to inspect DevTools, copy a request, write curl, or choose endpoints.',
    '',
    render_browser_operating_guide(),
  ].join('\n'),
};
