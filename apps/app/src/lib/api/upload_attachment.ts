import AwsS3 from '@uppy/aws-s3';
import Uppy from '@uppy/core';
import { api_client, read_api_data } from '@/lib/api/client';

// Sends one file's bytes from the browser to object storage without touching our API.
//
// Two steps: ask for a ticket (a few hundred bytes of JSON, which the /api proxy handles
// happily), then PUT the bytes to the URL it returns. The bytes never cross the Vercel
// Function that caps request bodies at 4.5 MB, which is what made a 9 MB attachment
// impossible to send.
//
// The transfer itself is Uppy's @uppy/aws-s3 (MIT), driven headlessly — our composer owns
// the drag-and-drop and the tray, so none of Uppy's UI plugins are used. It is here for the
// parts that are genuinely hard: retry with backoff, progress, abort, and chunked multipart
// when a file is large enough to want it. Uppy is storage-agnostic and speaks plain
// S3-compatible signing, so it works against the R2 bucket we already have and adds no
// hosted service.

export type UploadedAttachment = {
  file_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
};

export async function upload_attachment_to_storage(
  file: File,
  options: {
    session_id?: string;
    project_id?: string;
    signal?: AbortSignal;
    on_progress?: (fraction: number) => void;
  },
): Promise<UploadedAttachment> {
  const mime_type = file.type || 'application/octet-stream';
  // Held outside the plugin so the artifact id the server minted survives past the upload;
  // Uppy only hands back the storage response.
  let minted_file_id: string | undefined;

  const uppy = new Uppy({ autoProceed: false, allowMultipleUploadBatches: false }).use(AwsS3, {
    shouldUseMultipart: false,
    getUploadParameters: async () => {
      const ticket = await request_upload_ticket({
        file_name: file.name,
        mime_type,
        byte_size: file.size,
        ...(options.session_id ? { session_id: options.session_id } : {}),
        ...(options.project_id ? { project_id: options.project_id } : {}),
      });
      minted_file_id = ticket.file_id;
      return {
        method: ticket.upload_method,
        url: new URL(ticket.upload_url, globalThis.location.href).href,
        headers: ticket.upload_headers,
      };
    },
  });

  uppy.on('upload-progress', (_file, progress) => {
    if (progress.bytesTotal) options.on_progress?.(progress.bytesUploaded / progress.bytesTotal);
  });
  options.signal?.addEventListener('abort', () => uppy.cancelAll(), { once: true });

  try {
    uppy.addFile({ name: file.name, type: mime_type, data: file, source: 'chat-composer' });
    const result = await uppy.upload();
    const failure = result?.failed?.[0];
    if (failure) throw new Error(describe_upload_failure(file.name, failure.error));
    if (!minted_file_id) throw new Error(`Uploading ${file.name} produced no file id`);

    return {
      file_id: minted_file_id,
      file_name: file.name,
      mime_type,
      byte_size: file.size,
    };
  } finally {
    uppy.destroy();
  }
}

// A cross-origin PUT the browser refuses never reaches JavaScript with a reason: the
// browser reports a bare network failure, and Uppy surfaces that as "Unknown error". The
// overwhelmingly likely cause is the storage bucket having no CORS rule for this origin,
// so say that instead of handing the reader a dead end.
function describe_upload_failure(file_name: string, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  const is_opaque_network_failure =
    !reason || /unknown error|network|failed to fetch/iu.test(reason);
  if (!is_opaque_network_failure) return `Uploading ${file_name} failed: ${reason}`;
  return (
    `Uploading ${file_name} failed: the storage bucket refused the request from ` +
    `${globalThis.location?.origin ?? 'this origin'}. This is usually a missing CORS rule on ` +
    'the upload bucket — it must allow PUT and the content-type header from this origin.'
  );
}

type UploadTicket = {
  file_id: string;
  upload_url: string;
  upload_method: 'PUT';
  upload_headers: Record<string, string>;
};

async function request_upload_ticket(body: {
  file_name: string;
  mime_type: string;
  byte_size: number;
  session_id?: string;
  project_id?: string;
}) {
  const response = await api_client.v1.files.uploads.$post({ json: body });
  return read_api_data<UploadTicket>(response, { method: 'POST', path: '/v1/files/uploads' });
}
