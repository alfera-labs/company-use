import { parse_retry_after, sleep, ValidationError } from '@coworker/shared';
import {
  create_runtime_attachment_source_map,
  type RuntimeAttachmentSource,
} from '@runtime-platform/attachments/runtime_attachment_source';
import type { SlackChannelFile } from '@runtime-platform/channels/slack/channel_routing';
import { WebClient } from '@slack/web-api';

type RuntimeSlackFile = SlackChannelFile & { download_url?: string };
type CompleteSlackFile = Required<
  Pick<
    RuntimeSlackFile,
    'external_file_id' | 'file_name' | 'mime_type' | 'byte_size' | 'download_url'
  >
>;
type DescribedSlackFile = SlackChannelFile &
  Required<Pick<SlackChannelFile, 'external_file_id' | 'file_name' | 'mime_type'>>;

export async function create_slack_attachment_sources(
  token: string,
  team_id: string,
  files: SlackChannelFile[] | undefined,
) {
  if (!files?.length) return [];
  if (!token) throw new ValidationError('Slack connection has no bot credential for file access');
  const client = new WebClient(token, { retryConfig: { retries: 2 } });
  const described_files = await Promise.all(files.map((file) => describe_slack_file(client, file)));
  const sources = described_files.map((file) =>
    create_slack_attachment_source(client, token, team_id, file, () =>
      create_runtime_attachment_source_map(sources),
    ),
  );
  create_runtime_attachment_source_map(sources);
  return sources;
}

async function describe_slack_file(client: WebClient, file: SlackChannelFile) {
  if (has_source_description(file)) return file;
  return complete_slack_file(client, file);
}

function create_slack_attachment_source(
  client: WebClient,
  token: string,
  team_id: string,
  file: DescribedSlackFile | CompleteSlackFile,
  validate_resolved_sources: () => void,
): RuntimeAttachmentSource {
  const source: RuntimeAttachmentSource = {
    attachment_id: `slack:${team_id}:${file.external_file_id}`,
    file_name: file.file_name,
    mime_type: file.mime_type,
    byte_size: file.byte_size ?? 0,
    open_bytes: async () => {
      const complete_file = await complete_slack_file(client, file);
      source.file_name = complete_file.file_name;
      source.mime_type = complete_file.mime_type;
      source.byte_size = complete_file.byte_size;
      validate_resolved_sources();
      const download = await open_slack_file_bytes(token, complete_file);
      source.byte_size = download.byte_size;
      return download.bytes;
    },
  };
  return source;
}

async function complete_slack_file(client: WebClient, file: RuntimeSlackFile) {
  if (file.file_access !== 'check_file_info' && has_complete_metadata(file)) {
    return file as CompleteSlackFile;
  }
  const response = await client.files.info({ file: file.external_file_id });
  const provider_file = response.file;
  const file_name = provider_file?.name || file.file_name;
  const mime_type = provider_file?.mimetype || file.mime_type;
  const byte_size = provider_file?.size ?? file.byte_size;
  const download_url = provider_file?.url_private_download || provider_file?.url_private;
  const resolved: RuntimeSlackFile = {
    external_file_id: file.external_file_id,
    ...(file_name ? { file_name } : {}),
    ...(mime_type ? { mime_type } : {}),
    ...(byte_size !== undefined ? { byte_size } : {}),
    ...(download_url ? { download_url } : {}),
  };
  if (!has_complete_metadata(resolved)) {
    throw new ValidationError(`Slack file ${file.external_file_id} has incomplete metadata`);
  }
  return resolved as CompleteSlackFile;
}

async function open_slack_file_bytes(token: string, file: CompleteSlackFile) {
  let url = validate_slack_file_url(file.download_url);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new ValidationError('Slack file redirect has no destination');
      url = validate_slack_file_url(new URL(location, url).toString());
      continue;
    }
    if (response.status === 429) {
      await wait_for_retry_after(response.headers.get('retry-after'));
      continue;
    }
    if (!response.ok || !response.body) {
      throw new ValidationError(`Slack file download failed with status ${response.status}`);
    }
    const content_length = read_content_length(response);
    if (content_length !== null && content_length > file.byte_size) {
      throw new ValidationError(`Slack file ${file.file_name} exceeded its declared size`);
    }
    return {
      bytes: response.body,
      byte_size: content_length ?? file.byte_size,
    };
  }
  throw new ValidationError('Slack file download exceeded the retry or redirect limit');
}

function read_content_length(response: Response) {
  if (response.headers.has('content-encoding')) return null;
  const value = response.headers.get('content-length');
  if (value === null) return null;
  const byte_size = Number(value);
  return Number.isSafeInteger(byte_size) && byte_size >= 0 ? byte_size : null;
}

function validate_slack_file_url(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const slack_host = ['slack.com', 'slack-files.com', 'slack-edge.com'].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (url.protocol !== 'https:' || !slack_host) {
    throw new ValidationError('Slack file URL must use a Slack-owned HTTPS host');
  }
  return url;
}

function has_complete_metadata(file: RuntimeSlackFile): file is CompleteSlackFile {
  return Boolean(
    file.file_name && file.mime_type && file.byte_size !== undefined && file.download_url,
  );
}

function has_source_description(file: SlackChannelFile): file is DescribedSlackFile {
  return Boolean(file.file_name && file.mime_type);
}

async function wait_for_retry_after(value: string | null) {
  await sleep(Math.min(Math.max(parse_retry_after(value) ?? 1_000, 1_000), 10_000));
}
