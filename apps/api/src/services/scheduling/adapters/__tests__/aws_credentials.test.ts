import { afterEach, describe, expect, it, vi } from 'vitest';

const resolved_credentials = { accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' };
const fromWebToken = vi.fn(() => async () => resolved_credentials);
vi.mock('@aws-sdk/credential-providers', () => ({ fromWebToken }));

async function load(env: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@coworker/config', () => ({ env }));
  return import('@api/services/scheduling/adapters/aws_credentials');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@coworker/config');
  fromWebToken.mockClear();
});

describe('build_aws_credentials', () => {
  it('throws when the auth role ARN is missing (half-configured AWS backend)', async () => {
    const { build_aws_credentials } = await load({ AWS_AUTH_ROLE_ARN: undefined });
    await expect(build_aws_credentials()).rejects.toThrow(/AWS_AUTH_ROLE_ARN is required/);
  });

  it('throws when the OIDC audience is missing', async () => {
    const { build_aws_credentials } = await load({
      AWS_AUTH_ROLE_ARN: 'arn:aws:iam::1:role/auth',
      GCP_OIDC_AUDIENCE: undefined,
      AWS_REGION: 'us-east-1',
    });
    await expect(build_aws_credentials()).rejects.toThrow(/GCP_OIDC_AUDIENCE is required/);
  });

  it('returns null when the metadata fetch throws (off-GCP local dev)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('off-gcp');
      }),
    );
    const { build_aws_credentials } = await load({
      AWS_AUTH_ROLE_ARN: 'arn:aws:iam::1:role/auth',
      GCP_OIDC_AUDIENCE: 'coworker-aws-scheduler',
      AWS_REGION: 'us-east-1',
    });
    expect(await build_aws_credentials()).toBeNull();
  });

  it('returns null when the metadata server responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    );
    const { build_aws_credentials } = await load({
      AWS_AUTH_ROLE_ARN: 'arn:aws:iam::1:role/auth',
      GCP_OIDC_AUDIENCE: 'coworker-aws-scheduler',
      AWS_REGION: 'us-east-1',
    });
    expect(await build_aws_credentials()).toBeNull();
  });

  it('returns a provider that exchanges a freshly-fetched, trimmed ID token on each resolution', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '  the.id.token  ' })),
    );
    const { build_aws_credentials } = await load({
      AWS_AUTH_ROLE_ARN: 'arn:aws:iam::1:role/auth',
      GCP_OIDC_AUDIENCE: 'coworker-aws-scheduler',
      AWS_REGION: 'us-east-1',
    });
    const provider = await build_aws_credentials();
    expect(provider).not.toBeNull();
    expect(fromWebToken).not.toHaveBeenCalled();

    const credentials = await (provider as () => Promise<unknown>)();
    expect(credentials).toEqual(resolved_credentials);
    expect(fromWebToken).toHaveBeenCalledWith(
      expect.objectContaining({
        roleArn: 'arn:aws:iam::1:role/auth',
        webIdentityToken: 'the.id.token',
      }),
    );
  });

  it('re-fetches the ID token on every resolution so an expired token never sticks', async () => {
    const fetch_spy = vi.fn(async () => ({ ok: true, text: async () => 'tok' }));
    vi.stubGlobal('fetch', fetch_spy);
    const { build_aws_credentials } = await load({
      AWS_AUTH_ROLE_ARN: 'arn:aws:iam::1:role/auth',
      GCP_OIDC_AUDIENCE: 'coworker-aws-scheduler',
      AWS_REGION: 'us-east-1',
    });
    const provider = (await build_aws_credentials()) as () => Promise<unknown>;
    const calls_after_build = fetch_spy.mock.calls.length;
    await provider();
    await provider();
    expect(fetch_spy.mock.calls.length).toBe(calls_after_build + 2);
  });
});
