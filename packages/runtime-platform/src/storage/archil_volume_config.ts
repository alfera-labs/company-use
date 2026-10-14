import { env } from '@coworker/config';
import { AppError } from '@coworker/shared';
import type { R2Mount } from 'disk';

export type ArchilVolumeConfig = ReturnType<typeof read_archil_volume_config>;

/**
 * The Archil and R2 settings a volume needs. Validated once, and independent of any one volume:
 * the caller has to know the region before it claims a volume row, and only knows which volume
 * it got afterwards.
 */
export function read_archil_volume_config() {
  const api_key = env.ARCHIL_API_KEY;
  const region = env.ARCHIL_REGION;
  const bucket_name = env.R2_BUCKET_NAME;
  const bucket_endpoint = env.R2_BUCKET_ENDPOINT;
  const access_key_id = env.R2_ACCESS_KEY_ID;
  const secret_access_key = env.R2_SECRET_ACCESS_KEY;
  const required_values = [
    ['ARCHIL_API_KEY', api_key],
    ['ARCHIL_REGION', region],
    ['R2_BUCKET_NAME', bucket_name],
    ['R2_BUCKET_ENDPOINT', bucket_endpoint],
    ['R2_ACCESS_KEY_ID', access_key_id],
    ['R2_SECRET_ACCESS_KEY', secret_access_key],
  ] as const;
  const missing = required_values.flatMap(([name, value]) => (value ? [] : [name]));
  if (missing.length > 0) {
    throw new AppError(
      'volume_storage_not_configured',
      `Archil/R2 provisioning is missing: ${missing.join(', ')}.`,
      500,
    );
  }
  if (
    !api_key ||
    !region ||
    !bucket_name ||
    !bucket_endpoint ||
    !access_key_id ||
    !secret_access_key
  ) {
    throw new Error('Workspace storage configuration validation did not narrow its values.');
  }

  return { api_key, region, bucket_name, bucket_endpoint, access_key_id, secret_access_key };
}

/**
 * The bucket mount for one volume, at the path the volume row already records.
 *
 * It takes the path rather than rebuilding it on purpose. The disk's mount and the row's
 * `storage_path` have to be the same string, and the only way to guarantee that is for one of
 * them to be derived and the other to be read. Computing it twice is what put the backup and the
 * mount out of step in the first place.
 */
export function archil_r2_mount(config: ArchilVolumeConfig, storage_path: string): R2Mount {
  return {
    type: 'r2',
    bucketName: config.bucket_name,
    bucketEndpoint: config.bucket_endpoint,
    accessKeyId: config.access_key_id,
    secretAccessKey: config.secret_access_key,
    bucketPrefix: storage_path,
  };
}
