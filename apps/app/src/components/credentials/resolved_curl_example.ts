const masked_value = '••••••••';

export type ResolvedCurlHeader = {
  name: string;
  prefix?: string | undefined;
};

export function build_resolved_curl_example(input: {
  allowed_hosts: readonly string[];
  headers: readonly ResolvedCurlHeader[];
}): string {
  const hosts = input.allowed_hosts.map((host) => host.trim()).filter(Boolean);
  if (hosts.length === 0) return '';

  const header_lines = input.headers
    .filter((header) => header.name.trim().length > 0)
    .map((header) => {
      const prefix = header.prefix?.trim();
      const value = prefix ? `${prefix} ${masked_value}` : masked_value;
      return `  -H '${header.name.trim()}: ${value}'`;
    });

  return hosts
    .map((host) => {
      const request_line = `curl https://${host}/`;
      if (header_lines.length === 0) return request_line;
      return [`${request_line} \\`, header_lines.join(' \\\n')].join('\n');
    })
    .join('\n\n');
}
