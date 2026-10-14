import { format_error_message } from '@coworker/shared';
import { z } from 'zod';
import { is_same_origin_request } from '@/lib/same_origin_request';
import { safe_return_path, workspace_entry_path } from '@/lib/workos_auth_url';
import {
  choose_workspace_for_paused_sign_in,
  finish_with_chosen_workspace,
  finish_with_verified_email,
  pending_authentication_expiry_cookie,
  read_pending_authentication,
  read_pending_authentication_token,
} from '@/lib/workos_pending_authentication';
import {
  get_workos,
  seal_session_option,
  session_set_cookie,
  workos_client_id,
} from '@/lib/workos_session';

const send_code_body_schema = z.strictObject({ email: z.string().email() });
const verify_ownership_body_schema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
  returnTo: z.string().optional(),
});
const password_body_schema = z.strictObject({
  email: z.string().email(),
  password: z.string().min(1).max(500),
  returnTo: z.string().optional(),
});
const verify_code_body_schema = z.strictObject({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  returnTo: z.string().optional(),
});

async function read_request_json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function send_magic_auth_code(request: Request) {
  if (!is_same_origin_request(request)) return Response.json({ ok: false }, { status: 403 });
  const body = send_code_body_schema.safeParse(await read_request_json(request));
  if (!body.success) return Response.json({ ok: false }, { status: 400 });
  const email = body.data.email.trim();

  try {
    await create_magic_auth_code(email);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Magic auth code send failed; page will fall back to hosted flow', error);
    return Response.json({ ok: false });
  }
}

export async function verify_magic_auth_code(request: Request) {
  if (!is_same_origin_request(request)) return Response.json({ ok: false }, { status: 403 });
  const body = verify_code_body_schema.safeParse(await read_request_json(request));
  if (!body.success) return Response.json({ ok: false }, { status: 400 });
  const { email, code } = body.data;
  const return_to = safe_return_path(body.data.returnTo);

  try {
    return await sign_in_and_answer(return_to, () =>
      get_workos().userManagement.authenticateWithMagicAuth({
        clientId: workos_client_id(),
        email,
        code,
        session: seal_session_option(),
      }),
    );
  } catch (error) {
    console.error('Magic auth code verification failed', error);
    return Response.json({ ok: false });
  }
}

export async function sign_in_with_password(
  request: Request,
  check_password: PasswordCheck = check_password_with_workos,
) {
  if (!is_same_origin_request(request)) return Response.json({ ok: false }, { status: 403 });
  const body = password_body_schema.safeParse(await read_request_json(request));
  if (!body.success) return Response.json({ ok: false }, { status: 400 });
  const { email, password } = body.data;

  try {
    return await sign_in_and_answer(safe_return_path(body.data.returnTo), () =>
      check_password(email.trim(), password),
    );
  } catch (error) {
    console.error('Password sign-in failed', format_error_message(error));
    return Response.json({ ok: false });
  }
}

type PasswordCheck = (email: string, password: string) => Promise<AuthenticationResult>;

function check_password_with_workos(email: string, password: string) {
  return get_workos().userManagement.authenticateWithPassword({
    clientId: workos_client_id(),
    email,
    password,
    session: seal_session_option(),
  });
}

export async function verify_email_ownership(request: Request) {
  if (!is_same_origin_request(request)) return Response.json({ ok: false }, { status: 403 });
  const body = verify_ownership_body_schema.safeParse(await read_request_json(request));
  if (!body.success) return Response.json({ ok: false }, { status: 400 });

  const pending_token = read_pending_authentication_token(request);
  if (!pending_token) return Response.json({ ok: false }, { status: 400 });
  const return_to = safe_return_path(body.data.returnTo);

  try {
    const response = await sign_in_and_answer(return_to, () =>
      finish_with_verified_email(pending_token, body.data.code),
    );
    response.headers.append('Set-Cookie', pending_authentication_expiry_cookie());
    return response;
  } catch (error) {
    console.error('Email ownership verification failed', error);
    return Response.json({ ok: false });
  }
}

async function sign_in_and_answer(
  return_to: string,
  authenticate: () => Promise<AuthenticationResult>,
) {
  let authentication: AuthenticationResult;
  try {
    authentication = await authenticate();
  } catch (error) {
    const pending = read_pending_authentication(error);
    if (pending?.plan !== 'in_app' || pending.state !== 'organization_selection_required') {
      throw error;
    }
    const organization_id = await choose_workspace_for_paused_sign_in(pending.user);
    authentication = await finish_with_chosen_workspace(pending.token, organization_id);
  }
  if (!authentication.sealedSession) {
    throw new Error('WorkOS did not return a sealed session for a sealed authenticate call');
  }
  const response = Response.json({ ok: true, redirect: workspace_entry_path(return_to) });
  response.headers.append('Set-Cookie', session_set_cookie(authentication.sealedSession));
  return response;
}

type AuthenticationResult = Awaited<ReturnType<typeof finish_with_verified_email>>;

// A code can only be created for an existing user, so unknown emails become a user first —
// that is the entire in-app sign-up. The name is collected by onboarding, not the login page.
async function create_magic_auth_code(email: string) {
  const workos = get_workos();
  try {
    await workos.userManagement.createMagicAuth({ email });
  } catch (error) {
    if (!is_user_missing_error(error)) throw error;
    await workos.userManagement.createUser({ email });
    await workos.userManagement.createMagicAuth({ email });
  }
}

// WorkOS API errors carry structured status/code fields; the message regex is a last resort for
// error shapes the SDK wraps differently.
function is_user_missing_error(error: unknown) {
  const shape = error as { status?: unknown; code?: unknown; message?: unknown };
  if (shape.status === 404) return true;
  if (typeof shape.code === 'string' && /user_not_found|entity_not_found/.test(shape.code)) {
    return true;
  }
  const text = format_error_message(error);
  return /user_not_found|entity_not_found|not found/i.test(text);
}
