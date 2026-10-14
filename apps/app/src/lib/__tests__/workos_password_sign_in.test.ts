import { describe, expect, it } from 'vitest';
import { sign_in_with_password } from '@/lib/workos_magic_auth';

type Checked = Awaited<ReturnType<NonNullable<Parameters<typeof sign_in_with_password>[1]>>>;

function post(body: unknown, site = 'same-origin') {
  return new Request('https://app.example/auth/email/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sec-fetch-site': site },
    body: JSON.stringify(body),
  });
}

function accepts_only(email: string, password: string) {
  const seen: string[] = [];
  const check = async (given_email: string, given_password: string) => {
    seen.push(given_email);
    if (given_email !== email || given_password !== password) throw new Error('bad credentials');
    const signed_in: Pick<Checked, 'sealedSession'> = { sealedSession: 'sealed-session' };
    return signed_in as Checked;
  };
  return { check, seen };
}

describe('sign_in_with_password', () => {
  it('signs the session and sends the person into their workspace', async () => {
    const { check } = accepts_only('a@b.co', 'correct horse');
    const response = await sign_in_with_password(
      post({ email: 'a@b.co', password: 'correct horse', returnTo: '/brain' }),
      check,
    );

    expect(await response.json()).toEqual({
      ok: true,
      redirect: '/auth/organization/refresh?returnTo=%2Fbrain',
    });
    expect(response.headers.get('set-cookie')).toContain('sealed-session');
  });

  it('answers ok:false with no cookie when the password is wrong', async () => {
    const { check } = accepts_only('a@b.co', 'correct horse');
    const response = await sign_in_with_password(post({ email: 'a@b.co', password: 'no' }), check);

    expect(await response.json()).toEqual({ ok: false });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    const { check } = accepts_only('a@b.co', 'correct horse');
    const unknown = await sign_in_with_password(
      post({ email: 'nobody@b.co', password: 'correct horse' }),
      check,
    );
    const wrong = await sign_in_with_password(post({ email: 'a@b.co', password: 'no' }), check);

    expect([unknown.status, await unknown.json()]).toEqual([wrong.status, await wrong.json()]);
  });

  it('refuses a cross-site request and a malformed body before checking any password', async () => {
    const { check, seen } = accepts_only('a@b.co', 'correct horse');
    const cross_site = await sign_in_with_password(
      post({ email: 'a@b.co', password: 'correct horse' }, 'cross-site'),
      check,
    );
    const no_password = await sign_in_with_password(post({ email: 'a@b.co' }), check);
    const extra_field = await sign_in_with_password(
      post({ email: 'a@b.co', password: 'x', admin: true }),
      check,
    );

    expect([cross_site.status, no_password.status, extra_field.status]).toEqual([403, 400, 400]);
    expect(seen).toEqual([]);
  });
});
