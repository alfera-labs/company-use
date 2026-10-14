export function read_cookies_from_response(response: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const [name, ...value] = line.split(';')[0]?.split('=') ?? [];
    if (name) cookies[name] = value.join('=');
  }
  return cookies;
}

export function format_cookie_header(cookies: Readonly<Record<string, string>>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
