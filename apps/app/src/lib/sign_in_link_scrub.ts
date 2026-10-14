const sign_in_link_path = /\/join\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/gu;
const scrubbed_path = '/join/[link]';

/** A sign-in link holds its token in the address, so the address never goes into a report as it is. */
export function scrub_sign_in_links(text: string): string {
  return text.replace(sign_in_link_path, scrubbed_path);
}

/**
 * Replaces the token of every sign-in link in an error report, wherever an address is held:
 * the request, the page name, a breadcrumb, a span. The report is changed in place and returned.
 */
export function scrub_sign_in_links_in_report<Report>(report: Report): Report {
  scrub_strings_inside(report, new WeakSet());
  return report;
}

function scrub_strings_inside(holder: unknown, seen: WeakSet<object>) {
  if (typeof holder !== 'object' || holder === null || seen.has(holder)) return;
  seen.add(holder);
  for (const [key, value] of Object.entries(holder)) {
    if (typeof value === 'string') Reflect.set(holder, key, scrub_sign_in_links(value));
    else scrub_strings_inside(value, seen);
  }
}
