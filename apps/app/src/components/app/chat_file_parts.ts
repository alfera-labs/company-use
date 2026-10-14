import {
  downscale_image_for_chat,
  image_fits_inline,
  refuse_image_that_cannot_be_opened,
} from '@/components/app/downscale_image_for_chat';
import type { SessionMessagePart, SessionMessagePayload } from '@/lib/api';
import { upload_attachment_to_storage } from '@/lib/api/upload_attachment';

export type ReasoningLevel = NonNullable<SessionMessagePayload['reasoning_level']>;
export type ChatMessageModelRequest = {
  model_name?: string;
  model_provider?: NonNullable<SessionMessagePayload['model_provider']>;
  model_proxy?: NonNullable<SessionMessagePayload['model_proxy']>;
  reasoning_level?: ReasoningLevel;
};

type ChatAttachmentUploadStatus = 'uploading' | 'ready' | 'failed';

export type PendingChatAttachment = {
  id: string;
  name: string;
  mime_type: string;
  byte_size: number;
  upload_status: ChatAttachmentUploadStatus;
  upload_progress: number;
  upload_error?: string;
  part?: SessionMessagePart;
};

export function create_chat_message_payload(input: {
  message_text: string;
  attachments: PendingChatAttachment[];
  model: ChatMessageModelRequest;
}): SessionMessagePayload {
  const images = input.attachments
    .flatMap((item) => (item.part ? [item.part] : []))
    .filter(
      (part): part is Extract<SessionMessagePart, { type: 'image' }> => part.type === 'image',
    );
  const content = input.attachments
    .flatMap((item) => (item.part ? [item.part] : []))
    .filter(
      (part): part is Exclude<SessionMessagePart, { type: 'image' }> => part.type !== 'image',
    );

  return {
    ...(input.message_text ? { message: input.message_text } : {}),
    ...(content.length === 0 ? {} : { content }),
    ...(images.length === 0 ? {} : { images }),
    ...(input.model.model_name ? { model_name: input.model.model_name } : {}),
    ...(input.model.model_provider ? { model_provider: input.model.model_provider } : {}),
    ...(input.model.model_proxy ? { model_proxy: input.model.model_proxy } : {}),
    ...(input.model.reasoning_level ? { reasoning_level: input.model.reasoning_level } : {}),
  };
}

export async function create_pending_chat_attachment(
  file: File,
  options: {
    session_id?: string;
    signal?: AbortSignal;
    on_progress?: (fraction: number) => void;
  } = {},
): Promise<{ part: SessionMessagePart; mime_type: string }> {
  const mime_type = file.type || mime_type_from_file_name(file.name);
  if (mime_type.startsWith('image/')) {
    return { part: await image_file_to_message_part(file, mime_type), mime_type };
  }
  if (is_text_like_file(file, mime_type)) {
    return {
      part: {
        type: 'file',
        name: file.name,
        mime_type,
        text: truncate_text(await file.text(), 50_000),
      },
      mime_type,
    };
  }

  const uploaded = await upload_attachment_to_storage(file, options);
  return {
    part: { type: 'file', file_id: uploaded.file_id, name: file.name, mime_type },
    mime_type,
  };
}

export function files_from_data_transfer(data_transfer: DataTransfer) {
  const direct_files = Array.from(data_transfer.files ?? []);
  if (direct_files.length > 0) return direct_files;

  return Array.from(data_transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

async function image_file_to_message_part(
  file: File,
  mime_type: string,
): Promise<SessionMessagePart> {
  await refuse_image_that_cannot_be_opened(file, mime_type);
  const { data_url, mime_type: encoded_mime_type } = await encode_image_for_message(
    file,
    mime_type,
  );
  return {
    type: 'image',
    data: data_url_to_base64(data_url),
    mime_type: encoded_mime_type,
    detail: 'high',
    source: file.name,
  };
}

async function encode_image_for_message(file: File, mime_type: string) {
  if (image_fits_inline(file.size)) {
    return { data_url: await read_file_as_data_url(file), mime_type };
  }
  try {
    return await downscale_image_for_chat(file);
  } catch {
    return { data_url: await read_file_as_data_url(file), mime_type };
  }
}

function read_file_as_data_url(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function data_url_to_base64(data_url: string) {
  const comma_index = data_url.indexOf(',');
  return comma_index === -1 ? data_url : data_url.slice(comma_index + 1);
}

function is_text_like_file(file: File, mime_type: string) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return (
    mime_type.startsWith('text/') ||
    [
      'application/json',
      'application/ld+json',
      'application/xml',
      'application/yaml',
      'application/x-yaml',
    ].includes(mime_type) ||
    new Set([
      'c',
      'css',
      'csv',
      'go',
      'html',
      'java',
      'js',
      'json',
      'jsx',
      'log',
      'md',
      'py',
      'rb',
      'rs',
      'sql',
      'toml',
      'ts',
      'tsx',
      'txt',
      'xml',
      'yaml',
      'yml',
    ]).has(extension ?? '')
  );
}

function mime_type_from_file_name(file_name: string) {
  const extension = file_name.split('.').pop()?.toLowerCase();
  if (extension === 'md') return 'text/markdown';
  if (extension === 'json') return 'application/json';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function truncate_text(value: string, max_length: number) {
  if (value.length <= max_length) return value;
  return `${value.slice(0, max_length - 3)}...`;
}
