import { fromWebToken } from '@aws-sdk/credential-providers';
import { env } from '@coworker/config';

type AwsCredentials = ReturnType<typeof fromWebToken>;

// Credential-free GCP -> AWS auth for the Scheduler client. Cloud Run has no AWS metadata, so the
// default SDK chain finds nothing. Instead we fetch a Google-signed OIDC ID token for the service
// account and exchange it for short-lived AWS credentials via STS AssumeRoleWithWebIdentity, against
// AWS's built-in accounts.google.com identity provider. No long-lived AWS keys to store or rotate.
//
// Setup (one-time): an AWS IAM role (AWS_AUTH_ROLE_ARN) whose trust policy
// federates accounts.google.com and conditions on this service account's OIDC subject.

// Build the AWS credential provider. This is only called when the AWS backend is already selected
// (AWS_SCHEDULER_ROLE_ARN is set), so missing OIDC config is a misconfiguration, not an off-GCP case:
// throw loudly rather than return null and let the SDK fall back to its default credential chain
// (which finds nothing on Cloud Run, failing with an opaque error later). Returns null only for the
// genuine off-GCP case where the metadata server has no ID token (local dev), where the AWS backend
// would not actually run a scheduling op.
//
// The returned provider re-fetches a Google ID token on EVERY credential resolution. A Google ID
// token expires (~1h); fromWebToken captures the token it is given as a static string and would reuse
// the expired one when the SDK re-assumes the role, so a long-lived warm instance would start failing
// all schedule ops. Re-fetching per resolution means each STS re-assume gets a fresh token.
export async function build_aws_credentials(): Promise<AwsCredentials | null> {
  const role_arn = env.AWS_AUTH_ROLE_ARN;
  if (!role_arn) {
    throw new Error(
      'AWS_AUTH_ROLE_ARN is required when the AWS scheduler backend is selected (AWS_SCHEDULER_ROLE_ARN is set)',
    );
  }
  const audience = env.GCP_OIDC_AUDIENCE;
  if (!audience) {
    throw new Error(
      'GCP_OIDC_AUDIENCE is required when the AWS scheduler backend is selected — it must match the AWS role trust policy',
    );
  }
  if (!(await fetch_gcp_identity_token(audience))) return null;

  return () => assume_role_with_fresh_token({ role_arn, audience, region: env.AWS_REGION });
}

async function assume_role_with_fresh_token(input: {
  role_arn: string;
  audience: string;
  region: string;
}) {
  const token = await fetch_gcp_identity_token(input.audience);
  if (!token) throw new Error('No Google ID token available to assume the AWS role');
  return fromWebToken({
    roleArn: input.role_arn,
    roleSessionName: 'coworker-scheduler',
    webIdentityToken: token,
    clientConfig: { region: input.region },
  })();
}

async function fetch_gcp_identity_token(audience: string): Promise<string | null> {
  const url =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
    `?audience=${encodeURIComponent(audience)}&format=full`;
  try {
    const response = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!response.ok) return null;
    return (await response.text()).trim() || null;
  } catch {
    return null;
  }
}
