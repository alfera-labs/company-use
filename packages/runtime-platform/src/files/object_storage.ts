import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@coworker/config';
import {
  type FileStorageProvider,
  find_file_storage_location,
} from '@runtime-platform/files/file_storage_locations';
import { open_local_disk_object_storage } from '@runtime-platform/files/local_disk_object_storage';

let test_object_storage: ObjectStorage | undefined;

export type StoredObjectDescription = {
  byte_size: number;
  content_type: string | null;
  entity_tag: string | null;
};

export type ListedObject = {
  object_key: string;
  byte_size: number;
  entity_tag: string;
};

export type ObjectStorage = {
  put_if_absent: (input: {
    object_key: string;
    data: Uint8Array;
    content_type: string;
  }) => Promise<{ created: boolean }>;
  list_by_prefix: (input: {
    object_key_prefix: string;
    page_token?: string;
  }) => Promise<{ objects: ListedObject[]; next_page_token: string | null }>;
  read: (object_key: string) => Promise<Uint8Array>;
  open_stream: (object_key: string) => Promise<ReadableStream<Uint8Array>>;
  describe: (object_key: string) => Promise<StoredObjectDescription | null>;
  delete: (object_key: string) => Promise<void>;
  create_presigned_put_url: (input: {
    object_key: string;
    content_type: string;
    byte_size: number;
    expires_in_seconds: number;
  }) => Promise<string>;
  create_presigned_get_url: (input: {
    object_key: string;
    file_name: string;
    mime_type: string;
    expires_in_seconds: number;
  }) => Promise<string>;
};

// Cloudflare R2 through its S3-compatible API. R2 supports conditional writes
// (If-None-Match: *), which is what makes put_if_absent atomic.
function create_r2_object_storage(bucket: string): ObjectStorage {
  const client = new S3Client({
    region: 'auto',
    endpoint: require_env('R2_BUCKET_ENDPOINT', env.R2_BUCKET_ENDPOINT),
    credentials: {
      accessKeyId: require_env('R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID),
      secretAccessKey: require_env('R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY),
    },
  });

  return {
    put_if_absent: async ({ object_key, data, content_type }) => {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: object_key,
            Body: data,
            ContentType: content_type,
            IfNoneMatch: '*',
          }),
        );
        return { created: true };
      } catch (error) {
        if (http_status(error) === 412) return { created: false };
        throw error;
      }
    },
    list_by_prefix: async ({ object_key_prefix, page_token }) => {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: object_key_prefix,
          ContinuationToken: page_token,
        }),
      );
      return {
        objects: (result.Contents ?? []).flatMap((object) =>
          object.Key === undefined
            ? []
            : [
                {
                  object_key: object.Key,
                  byte_size: object.Size ?? 0,
                  entity_tag: object.ETag ?? '',
                },
              ],
        ),
        next_page_token: result.IsTruncated ? (result.NextContinuationToken ?? null) : null,
      };
    },
    read: async (object_key) => {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object_key }));
      if (!result.Body) throw new Error(`Object ${object_key} has no content`);
      return result.Body.transformToByteArray();
    },
    open_stream: async (object_key) => {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object_key }));
      if (!result.Body) throw new Error(`Object ${object_key} has no content`);
      return result.Body.transformToWebStream() as ReadableStream<Uint8Array>;
    },
    describe: async (object_key) => {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: object_key }),
        );
        return {
          byte_size: result.ContentLength ?? 0,
          content_type: result.ContentType ?? null,
          entity_tag: result.ETag ?? null,
        };
      } catch (error) {
        if (http_status(error) === 404) return null;
        throw error;
      }
    },
    delete: async (object_key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object_key }));
    },
    // Content-Length is signed, so the ticket is a hard size ceiling. Content-Type is NOT
    // signed by default — the presigner adds it to unsignableHeaders — so it has to be named
    // in signableHeaders explicitly, or a ticket holder could store any type under the key.
    create_presigned_put_url: ({ object_key, content_type, byte_size, expires_in_seconds }) =>
      getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: object_key,
          ContentType: content_type,
          ContentLength: byte_size,
        }),
        { expiresIn: expires_in_seconds, signableHeaders: new Set(['content-type']) },
      ),
    create_presigned_get_url: ({ object_key, file_name, mime_type, expires_in_seconds }) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: object_key,
          ResponseContentType: mime_type,
          ResponseContentDisposition: `attachment; filename="${encode_download_name(file_name)}"`,
        }),
        { expiresIn: expires_in_seconds },
      ),
  };
}

const object_storage_by_provider = new Map<FileStorageProvider, ObjectStorage>();

export function open_file_object_storage(storage_provider: FileStorageProvider): ObjectStorage {
  if (test_object_storage) return test_object_storage;
  const cached = object_storage_by_provider.get(storage_provider);
  if (cached) return cached;

  const { location } = find_file_storage_location(storage_provider);
  const bucket_env_name = location.bucket_env_name;
  if (location.reads_bytes_from !== 'object_bucket' || !bucket_env_name) {
    throw new Error(`Artifact storage provider ${storage_provider} is not an object bucket`);
  }
  const storage =
    open_local_disk_object_storage(bucket_env_name) ??
    create_r2_object_storage(require_env(bucket_env_name, env[bucket_env_name]));
  object_storage_by_provider.set(storage_provider, storage);
  return storage;
}

export function set_memory_import_object_storage_for_tests(storage?: ObjectStorage) {
  if (env.NODE_ENV !== 'test') throw new Error('Object storage overrides are test-only');
  test_object_storage = storage;
  object_storage_by_provider.clear();
}

function require_env(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is required to read or write artifact bytes`);
  return value;
}

function encode_download_name(file_name: string) {
  return file_name.replace(/[\r\n"\\]/gu, '_');
}

function http_status(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode ?? null;
}
