import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { env } from '@coworker/config';
import { Archil } from 'disk';

export function read_live_test_config() {
  if (!env.COWORKER_PERSISTENT_WORKSPACES_ENABLED) {
    throw new Error(
      'Live persistent-workspace test requires COWORKER_PERSISTENT_WORKSPACES_ENABLED=1.',
    );
  }
  const required = {
    e2b_api_key: env.E2B_API_KEY,
    archil_api_key: env.ARCHIL_API_KEY,
    archil_region: env.ARCHIL_REGION,
    r2_bucket_name: env.R2_BUCKET_NAME,
    r2_bucket_endpoint: env.R2_BUCKET_ENDPOINT,
    r2_access_key_id: env.R2_ACCESS_KEY_ID,
    r2_secret_access_key: env.R2_SECRET_ACCESS_KEY,
    browser_encryption_key: env.COWORKER_BROWSER_STATE_ENCRYPTION_KEY,
  };
  const missing = Object.entries(required).flatMap(([name, value]) => (value ? [] : [name]));
  if (missing.length > 0) {
    throw new Error(`Live persistent-workspace test is missing: ${missing.join(', ')}`);
  }
  if (!required.r2_bucket_name || !/(test|nonprod|staging|dev)/iu.test(required.r2_bucket_name)) {
    throw new Error(
      'Live persistent-workspace cleanup requires a test/nonprod/staging/dev R2 bucket.',
    );
  }
  if (!required.archil_api_key || !required.archil_region) {
    throw new Error('Live test config validation did not narrow Archil credentials.');
  }
  if (
    !required.r2_bucket_name ||
    !required.r2_bucket_endpoint ||
    !required.r2_access_key_id ||
    !required.r2_secret_access_key
  ) {
    throw new Error('Live test config validation did not narrow R2 credentials.');
  }
  return {
    archil_api_key: required.archil_api_key,
    archil_region: required.archil_region,
    r2_bucket_name: required.r2_bucket_name,
    r2_bucket_endpoint: required.r2_bucket_endpoint,
    r2_access_key_id: required.r2_access_key_id,
    r2_secret_access_key: required.r2_secret_access_key,
  };
}

export async function delete_test_disk(
  config: ReturnType<typeof read_live_test_config>,
  provider_volume_id: string,
  workspace_id: string,
) {
  const errors: unknown[] = [];
  const archil = new Archil({ apiKey: config.archil_api_key, region: config.archil_region });
  try {
    const disk = await archil.disks.get(provider_volume_id);
    await disk.delete();
  } catch (error) {
    errors.push(error);
  }
  try {
    await delete_r2_workspace_prefix_when_stable(config, workspace_id);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Live-test Archil/R2 cleanup failed.');
  }
}

export async function delete_r2_workspace_prefix_when_stable(
  config: ReturnType<typeof read_live_test_config>,
  workspace_id: string,
  attempts_remaining = 12,
  consecutive_empty_checks = 0,
): Promise<void> {
  const deleted_count = await delete_r2_workspace_prefix_batch(config, workspace_id);
  const empty_checks = deleted_count === 0 ? consecutive_empty_checks + 1 : 0;
  if (empty_checks >= 2) return;
  if (attempts_remaining <= 1) {
    throw new Error(
      'Live-test R2 prefix kept receiving objects after its Archil disk was deleted.',
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  return delete_r2_workspace_prefix_when_stable(
    config,
    workspace_id,
    attempts_remaining - 1,
    empty_checks,
  );
}

export async function delete_r2_workspace_prefix_batch(
  config: ReturnType<typeof read_live_test_config>,
  workspace_id: string,
) {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.r2_bucket_endpoint,
    credentials: {
      accessKeyId: config.r2_access_key_id,
      secretAccessKey: config.r2_secret_access_key,
    },
  });
  const prefix = `coworker/workspaces/${workspace_id}/`;
  const listed = await client.send(
    new ListObjectsV2Command({
      Bucket: config.r2_bucket_name,
      Prefix: prefix,
      MaxKeys: 1_000,
    }),
  );
  if (listed.IsTruncated) {
    throw new Error(`Live-test R2 prefix ${prefix} unexpectedly contains more than 1,000 objects.`);
  }
  const objects = (listed.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));
  if (objects.length === 0) return 0;
  await client.send(
    new DeleteObjectsCommand({
      Bucket: config.r2_bucket_name,
      Delete: { Objects: objects, Quiet: true },
    }),
  );
  return objects.length;
}
