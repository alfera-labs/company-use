export const bucket_env_names = [
  'ARTIFACT_UPLOAD_BUCKET',
  'MEMORY_IMPORT_BUCKET',
  'R2_BUCKET_NAME',
  'VOLUME_BACKUP_BUCKET',
] as const;

export type BucketEnvName = (typeof bucket_env_names)[number];

export type FileStorageLocation = {
  reads_bytes_from: 'object_bucket' | 'sandbox_or_volume_path' | 'named_external_source';
  bucket_env_name?: BucketEnvName;
  browser_can_upload_here: boolean;
  bytes_survive_the_sandbox: boolean;
};

export const file_storage_locations = {
  object_store: {
    reads_bytes_from: 'object_bucket',
    bucket_env_name: 'ARTIFACT_UPLOAD_BUCKET',
    browser_can_upload_here: true,
    bytes_survive_the_sandbox: true,
  },
  memory_import_store: {
    reads_bytes_from: 'object_bucket',
    bucket_env_name: 'MEMORY_IMPORT_BUCKET',
    browser_can_upload_here: false,
    bytes_survive_the_sandbox: false,
  },
  r2: {
    reads_bytes_from: 'object_bucket',
    bucket_env_name: 'MEMORY_IMPORT_BUCKET',
    browser_can_upload_here: false,
    bytes_survive_the_sandbox: false,
  },
  volume_object_store: {
    reads_bytes_from: 'object_bucket',
    bucket_env_name: 'R2_BUCKET_NAME',
    browser_can_upload_here: false,
    bytes_survive_the_sandbox: true,
  },
  volume_backup_store: {
    reads_bytes_from: 'object_bucket',
    bucket_env_name: 'VOLUME_BACKUP_BUCKET',
    browser_can_upload_here: false,
    bytes_survive_the_sandbox: true,
  },
  local_workspace: {
    reads_bytes_from: 'sandbox_or_volume_path',
    browser_can_upload_here: false,
    bytes_survive_the_sandbox: false,
  },
  external_reference: {
    reads_bytes_from: 'named_external_source',
    browser_can_upload_here: false,
    bytes_survive_the_sandbox: false,
  },
} as const satisfies Record<string, FileStorageLocation>;

export type FileStorageProvider = keyof typeof file_storage_locations;

export const default_file_storage_provider = 'object_store' satisfies FileStorageProvider;

export function is_known_file_storage_provider(value: string): value is FileStorageProvider {
  return Object.hasOwn(file_storage_locations, value);
}

export function find_file_storage_location(storage_provider: string): {
  storage_provider: FileStorageProvider;
  location: FileStorageLocation;
} {
  if (!is_known_file_storage_provider(storage_provider)) {
    throw new Error(
      `File storage provider ${storage_provider} is not registered in file_storage_locations`,
    );
  }
  return { storage_provider, location: file_storage_locations[storage_provider] };
}
