import { find_connection_auth_failure } from '@runtime-platform/tools/connection_auth_failure';
import { describe, expect, it } from 'vitest';

describe('find_connection_auth_failure', () => {
  it('catches the Google refusal that reached the agent as a 200', () => {
    const output =
      'Request had invalid authentication credentials. Expected OAuth 2 access token, login ' +
      'cookie or other valid authentication credential. See https://developers.google.com/...';

    const failure = find_connection_auth_failure(output);

    expect(failure).not.toBeNull();
    expect(failure?.provider_hint).toBe('google');
  });

  it('catches the standard OAuth refusals every provider emits on a dead token', () => {
    for (const body of [
      '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
      '{"error":"invalid_token"}',
      '{"ok":false,"error":"invalid_auth"}',
      '{"ok":false,"error":"token_revoked"}',
      '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}',
    ]) {
      expect(find_connection_auth_failure(body), body).not.toBeNull();
    }
  });

  it('catches the refusal an API-key service sends back through Composio', () => {
    const error =
      'Google Light Search failed with status 401. Error: Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key';
    expect(find_connection_auth_failure(error)).toEqual({
      matched_text: 'Invalid API key',
      provider_hint: 'api_key',
    });
  });

  it('reads a structured result, not only a string', () => {
    const output = { summary: 'failed', detail: { message: 'Invalid Credentials', code: 401 } };

    expect(find_connection_auth_failure(output)?.provider_hint).toBe('google');
  });

  it('does not fire on ordinary content that merely mentions auth', () => {
    for (const body of [
      '{"subject":"Your invoice is unauthorized for release","from":"billing@example.com"}',
      '{"messages":[{"snippet":"the token for the meeting room is 4821"}]}',
      '{"doc":"Our authentication guide explains how credentials work"}',
      '{"error":"rate_limit_exceeded"}',
      '{"error":"not_found","message":"No such file"}',
      '{"results":[],"query":"invalid credentials policy draft"}',
    ]) {
      expect(find_connection_auth_failure(body), body).toBeNull();
    }
  });

  it('is quiet on empty and unserializable input rather than guessing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(find_connection_auth_failure(null)).toBeNull();
    expect(find_connection_auth_failure(undefined)).toBeNull();
    expect(find_connection_auth_failure('')).toBeNull();
    expect(find_connection_auth_failure(circular)).toBeNull();
  });
});
