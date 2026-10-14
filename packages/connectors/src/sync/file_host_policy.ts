import { getDomain, parse } from 'tldts';

export type FileHostPolicy = {
  allowed_hosts: readonly string[];
  base_url_host: string;
};

type FileHostEntry = {
  protocol: 'https:' | 'http:';
  host: string;
  wildcard: boolean;
  port: string;
};

const host_entry_pattern =
  /^(?:(https?):\/\/)?(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.?(?::(\d{1,5}))?$/u;

const default_port_by_protocol: Record<FileHostEntry['protocol'], string> = {
  'https:': '443',
  'http:': '80',
};

const public_suffix_options = { allowPrivateDomains: true };

const numeric_label_pattern = /^\d+$/u;

function last_label_is_numeric(host: string): boolean {
  return numeric_label_pattern.test(host.split('.').at(-1) ?? '');
}

export function wildcard_base_is_refused(base: string): boolean {
  if (!base.includes('.') || last_label_is_numeric(base)) return true;
  const parsed_base = parse(base, public_suffix_options);
  return parsed_base.isIp === true || parsed_base.domain === null;
}

export function file_fetch_host_entry_is_allowed(host_entry: string): boolean {
  if (!host_entry.startsWith('*.')) return true;
  return !wildcard_base_is_refused(host_entry.slice(2));
}

function registrable_domain_covers_entry(entry_host: string, hostname: string): boolean {
  const registrable_domain = getDomain(hostname, public_suffix_options);
  if (registrable_domain === null) return false;
  return entry_host === registrable_domain || entry_host.endsWith(`.${registrable_domain}`);
}

function read_entry_protocol(scheme: string | undefined): FileHostEntry['protocol'] {
  return scheme === 'http' ? 'http:' : 'https:';
}

function read_entry_port(protocol: FileHostEntry['protocol'], port: string | undefined) {
  if (port === undefined || port === default_port_by_protocol[protocol]) return '';
  return port;
}

function wildcard_entry_is_refused(wildcard: boolean, host: string): boolean {
  return wildcard && wildcard_base_is_refused(host);
}

function parse_host_entry(entry: string): FileHostEntry | null {
  const match = host_entry_pattern.exec(entry.trim().toLowerCase());
  const host = match?.[3];
  if (!match || !host) return null;
  const wildcard = match[2] !== undefined;
  if (wildcard_entry_is_refused(wildcard, host)) return null;
  const protocol = read_entry_protocol(match[1]);
  return { protocol, host, wildcard, port: read_entry_port(protocol, match[4]) };
}

function parse_base_url_entry(base_url_host: string) {
  const entry = parse_host_entry(base_url_host);
  return entry && !entry.wildcard ? [entry] : [];
}

function list_policy_entries(policy: FileHostPolicy): FileHostEntry[] {
  const allowed_entries = policy.allowed_hosts
    .map(parse_host_entry)
    .filter((entry) => entry !== null);
  return [...parse_base_url_entry(policy.base_url_host), ...allowed_entries];
}

function normalize_hostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/u, '');
}

function entry_matches_host(entry: FileHostEntry, hostname: string) {
  if (hostname === entry.host) return true;
  if (!entry.wildcard || !hostname.endsWith(`.${entry.host}`)) return false;
  return registrable_domain_covers_entry(entry.host, hostname);
}

function entry_allows_url(entry: FileHostEntry, url: URL) {
  if (entry.protocol !== url.protocol) return false;
  if (entry.port !== url.port) return false;
  return entry_matches_host(entry, normalize_hostname(url.hostname));
}

export function is_file_url_allowed(policy: FileHostPolicy, url: URL): boolean {
  return list_policy_entries(policy).some((entry) => entry_allows_url(entry, url));
}

export function is_protocol_downgrade(original_url: URL, next_url: URL): boolean {
  return original_url.protocol === 'https:' && next_url.protocol !== 'https:';
}
