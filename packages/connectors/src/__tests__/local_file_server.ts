import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { createServer as create_tls_server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  FetchConnectorFileDependencies,
  FetchConnectorFileLimits,
  FileRequestSender,
} from '@connectors/runtime/fetch_connector_file';
import type { FileHostPolicy } from '@connectors/sync/file_host_policy';

export type LocalServerHit = { path: string; authorization: string | null };

export type LocalServerRoute = (request: IncomingMessage, response: ServerResponse) => void;

export type LocalServer = {
  url: string;
  port: number;
  hits: LocalServerHit[];
  stop: () => Promise<void>;
};

export type LocalCertificate = { cert: string; key: string };

export type RecordingSender = { send_request: FileRequestSender; sent_urls: string[] };

export const secret_token = 'Bearer xoxb-SECRET-TOKEN-1234';

export const test_limits: FetchConnectorFileLimits = {
  max_bytes: 1024 * 1024,
  max_redirects: 3,
  timeout_ms: 5000,
};

export function create_localhost_certificate(): LocalCertificate {
  const directory = mkdtempSync(join(tmpdir(), 'file-door-cert-'));
  const key_path = join(directory, 'key.pem');
  const cert_path = join(directory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1'],
      ...['-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
      ...['-keyout', key_path, '-out', cert_path],
    ],
    { stdio: 'ignore' },
  );
  const certificate = {
    cert: readFileSync(cert_path, 'utf8'),
    key: readFileSync(key_path, 'utf8'),
  };
  rmSync(directory, { recursive: true, force: true });
  return certificate;
}

function create_server(route: LocalServerRoute, certificate: LocalCertificate | null): Server {
  return certificate ? create_tls_server(certificate, route) : createServer(route);
}

function stop_server(server: Server) {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function start_local_server(
  route: LocalServerRoute,
  options: { hostname?: string; certificate?: LocalCertificate } = {},
): Promise<LocalServer> {
  const hostname = options.hostname ?? 'localhost';
  const hits: LocalServerHit[] = [];
  const server = create_server((request, response) => {
    hits.push({ path: request.url ?? '', authorization: request.headers.authorization ?? null });
    route(request, response);
  }, options.certificate ?? null);
  await new Promise<void>((resolve) => server.listen(0, hostname, resolve));
  const address: AddressInfo | string | null = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const scheme = options.certificate ? 'https' : 'http';
  return { url: `${scheme}://${hostname}:${port}`, port, hits, stop: () => stop_server(server) };
}

export function create_recording_sender(certificate?: LocalCertificate): RecordingSender {
  const sent_urls: string[] = [];
  const tls = certificate ? { tls: { ca: certificate.cert } } : {};
  const send_request: FileRequestSender = (url, init) => {
    sent_urls.push(url.toString());
    return fetch(url, Object.assign({}, init, tls));
  };
  return { send_request, sent_urls };
}

export function create_offline_sender(): RecordingSender {
  const sent_urls: string[] = [];
  const send_request: FileRequestSender = (url) => {
    sent_urls.push(url.toString());
    return Promise.reject(new TypeError('the offline sender never connects'));
  };
  return { send_request, sent_urls };
}

export function build_dependencies(
  policy: FileHostPolicy,
  sender: RecordingSender,
  limits: Partial<FetchConnectorFileLimits> = {},
): FetchConnectorFileDependencies {
  return { policy, limits: { ...test_limits, ...limits }, send_request: sender.send_request };
}

export function http_policy_for(...servers: LocalServer[]): FileHostPolicy {
  return {
    allowed_hosts: servers.map((server) => `http://localhost:${server.port}`),
    base_url_host: 'api.example.invalid',
  };
}
