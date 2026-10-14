import { env } from '@coworker/config';
import { create_logger, find_model_proxy_credential } from '@coworker/shared';
import type { RuntimeAttachmentSource } from '@runtime-platform/attachments/runtime_attachment_source';
import OpenAI from 'openai';

const log = create_logger('transcribe_audio');
const transcription_model = 'whisper-1';
const max_transcribable_bytes = 25 * 1024 * 1024;

export async function transcribe_audio_attachment(
  source: RuntimeAttachmentSource,
): Promise<string | null> {
  const credentials = find_transcription_credentials();
  if (!credentials) return null;
  if (source.byte_size > max_transcribable_bytes) {
    log.warn('audio attachment too large to transcribe', {
      attachment_id: source.attachment_id,
      byte_size: source.byte_size,
    });
    return null;
  }

  try {
    const bytes = await read_attachment_bytes(source);
    const client = new OpenAI({
      apiKey: credentials.api_key,
      ...(credentials.base_url ? { baseURL: credentials.base_url } : {}),
    });
    const result = await client.audio.transcriptions.create({
      model: transcription_model,
      file: new File([bytes as BlobPart], source.file_name, { type: source.mime_type }),
    });
    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch (error) {
    log.warn('audio transcription failed; delivering the attachment without a transcript', {
      attachment_id: source.attachment_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function find_transcription_credentials(): { api_key: string; base_url?: string } | null {
  const direct = find_model_proxy_credential('openai_direct', env);
  if (direct) return { api_key: direct.api_key };
  const gateway = find_model_proxy_credential('vercel_ai_gateway', env);
  if (gateway && env.VERCEL_AI_GATEWAY_BASE_URL) {
    return { api_key: gateway.api_key, base_url: env.VERCEL_AI_GATEWAY_BASE_URL };
  }
  return null;
}

async function read_attachment_bytes(source: RuntimeAttachmentSource) {
  return new Uint8Array(await new Response(await source.open_bytes()).arrayBuffer());
}
