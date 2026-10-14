export function url_matches_allowed_request_origin(
  url: URL,
  allowed_request_origins: readonly string[],
) {
  return allowed_request_origins.some((allowed_origin) => {
    const wildcard = parse_wildcard_origin(allowed_origin);
    if (wildcard) {
      return (
        url.protocol === wildcard.protocol &&
        url.port === wildcard.port &&
        url.hostname.endsWith(`.${wildcard.hostname}`)
      );
    }
    return parse_url(allowed_origin)?.origin.toLowerCase() === url.origin.toLowerCase();
  });
}

function parse_wildcard_origin(value: string) {
  const match = /^(https?):\/\/\*\.([^/:]+)(?::(\d+))?$/iu.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return {
    protocol: `${match[1].toLowerCase()}:`,
    hostname: match[2].toLowerCase(),
    port: match[3] ?? '',
  };
}

export function parse_url(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
