import { brand_mark_path, brand_mark_view_box } from '@/components/app/brand_mark';

const page_headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
};

const page_style = `
  :root { color-scheme: light dark; --page: #fbfaf9; --ink: #1c1a17; --quiet: #6b665f; }
  @media (prefers-color-scheme: dark) {
    :root { --page: #202026; --ink: #f5f5f7; --quiet: #b0b0ba; }
  }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: var(--page); color: var(--ink);
    font: 16px/1.5 "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; padding: 2rem 1.5rem; }
  svg { display: block; width: 1.75rem; height: 1.75rem; margin: 0 0 1.5rem; fill: currentColor; }
  h1 { margin: 0 0 .5rem; font-size: 1.5rem; font-weight: 600; line-height: 1.25;
    letter-spacing: -.01em; }
  p { margin: 0 0 1rem; color: var(--quiet); }
  code { font: .875rem ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
  button { font: inherit; font-weight: 500; margin-top: .5rem; padding: .75rem 1.5rem; border: 0;
    border-radius: 999px; background: var(--ink); color: var(--page); cursor: pointer; }
`;

const brand_mark_html = `<svg viewBox="${brand_mark_view_box}" role="img" aria-label="Alfera"><path d="${brand_mark_path}"/></svg>`;

export function escape_html(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * A page for a browser that has no session, so it is plain HTML with no script and none of the
 * app's own code. The link token is in the address, so the page tells no other site where it
 * came from, loads nothing, posts only to itself and cannot be framed. The referrer policy is
 * `same-origin` and not `no-referrer`: under `no-referrer` a browser sends `Origin: null` with
 * the button's POST, and on plain http that Origin is the only proof the POST came from this
 * page. `body_html` is markup: every value in it that a person typed must have gone through
 * escape_html. The page wears the mark and the colours of the app (packages/ui globals.css),
 * written out, and the font the app falls back to: a font file would be one more request.
 */
export function team_page(input: { status: number; title: string; body_html: string }): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape_html(input.title)}</title>
<style>${page_style}</style>
</head>
<body><main>${brand_mark_html}${input.body_html}</main></body>
</html>`;
  return new Response(html, { status: input.status, headers: page_headers });
}

/**
 * For a browser that still holds the session of a person who was removed. It says what
 * happened and whom to ask, so nobody reads a removal as a broken sign-in.
 */
export function access_ended_page(workspace_name: string): Response {
  const workspace = workspace_name ? escape_html(workspace_name) : 'this workspace';
  return team_page({
    status: 403,
    title: 'Your access has ended',
    body_html: `<h1>Your access to ${workspace} has ended</h1>
<p>You were removed from the workspace, so this browser is signed out.</p>
<p>If you need access again, ask the owner or an admin of the workspace for a new sign-in link.</p>`,
  });
}

/** One page for every reason a link fails, so the answer says nothing about which reason it was. */
export function link_not_valid_page(): Response {
  return team_page({
    status: 404,
    title: 'This link is not valid any more',
    body_html: `<h1>This link is not valid any more</h1>
<p>A sign-in link works once and for a limited time. Ask the owner or an admin of the workspace for a new one.</p>`,
  });
}

/**
 * A person who has not joined yet reads "Join"; a member who signs in again reads "Sign in to".
 * The headline names the workspace and the button is the one verb, so the two are not one
 * sentence twice.
 */
export function join_confirm_page(input: {
  workspace_name: string;
  person_name: string;
  has_joined_before: boolean;
}): Response {
  const workspace_name = escape_html(input.workspace_name);
  const greeting = input.person_name ? `Hello ${escape_html(input.person_name)}.` : 'Hello.';
  const verb = input.has_joined_before ? 'Sign in to' : 'Join';
  const button_words = input.has_joined_before ? 'Sign in' : 'Join';
  return team_page({
    status: 200,
    title: `${verb} ${input.workspace_name}`,
    body_html: `<h1>${verb} ${workspace_name}</h1>
<p>${greeting} This link signs you in on this browser. It works once.</p>
<form method="post"><button type="submit">${button_words}</button></form>`,
  });
}

export function sign_in_page_redirect(request: Request): Response {
  const asked = new URL(request.url);
  const return_to = `${asked.pathname}${asked.search}`;
  const location =
    return_to === '/' ? '/sign-in' : `/sign-in?returnTo=${encodeURIComponent(return_to)}`;
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}
