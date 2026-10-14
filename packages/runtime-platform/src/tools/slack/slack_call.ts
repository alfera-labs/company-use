import { AppError } from '@coworker/shared';
import type { WebAPICallResult } from '@slack/web-api';

type SlackSdkError = Error & {
  code?: string;
  data?: { error?: string };
};

export async function slack_call<T extends WebAPICallResult>(call: () => Promise<T>): Promise<T> {
  try {
    const response = await call();
    const error_code = read_response_error_code(response);
    if (error_code) throw slack_api_error(error_code);
    return response;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw slack_api_error(read_slack_error_code(error));
  }
}

function read_slack_error_code(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const slack_error = error as SlackSdkError;
  return slack_error.data?.error ?? slack_error.code ?? slack_error.message;
}

function read_response_error_code(response: WebAPICallResult): string | null {
  if (response.ok !== false) return null;
  return response.error ?? 'unknown';
}

function slack_api_error(code: string | undefined) {
  return new AppError('slack_api_error', `Slack API error: ${code ?? 'unknown'}`, 500, {
    slack_error: code ?? null,
  });
}
