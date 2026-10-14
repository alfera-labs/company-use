export type InstallStepAnswer<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

const words_when_nothing_answers = 'Alfera did not answer. Check your connection, then try again.';

type Body = { data?: unknown; error?: { code?: string; message?: string; details?: unknown } };

export async function ask_install_step<T>(
  path: string,
  body?: Record<string, unknown>,
): Promise<InstallStepAnswer<T>> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
    const answer = (await response.json().catch(() => ({}))) as Body;
    if (response.ok) return { ok: true, data: answer.data as T };
    return {
      ok: false,
      status: response.status,
      code: answer.error?.code ?? 'unknown',
      message: answer.error?.message ?? words_when_nothing_answers,
      details: answer.error?.details,
    };
  } catch {
    return { ok: false, status: 0, code: 'unreachable', message: words_when_nothing_answers };
  }
}
