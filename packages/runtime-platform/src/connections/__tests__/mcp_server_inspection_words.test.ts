import { inspect_mcp_server } from '@runtime-platform/connections/mcp_server_inspection';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34' }] }));

afterEach(() => vi.unstubAllGlobals());

async function ask_a_server_that(answers: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(answers));
  const inspection = await inspect_mcp_server({ server_url: 'https://www.acme.test/' });
  return inspection.inspected ? 'inspected' : inspection.because;
}

function fail_as(error_name: string, message: string) {
  return async () => {
    throw new DOMException(message, error_name);
  };
}

describe('what the dialog says when the address is not an MCP server that answers', () => {
  it('says a web page is not an MCP server, and where the address usually ends', async () => {
    const because = await ask_a_server_that(async () => new Response('<html>', { status: 405 }));

    expect(because).toBe(
      'That address is a web page, not an MCP server (HTTP 405). Give the address of the MCP server itself. For most servers the address ends in /mcp.',
    );
  });

  it('says the same of a web server that answers that it does not support the method', async () => {
    const page_of_a_plain_web_server =
      '<!DOCTYPE HTML>\n<html lang="en"><head><title>Error response</title></head><body><h1>Error response</h1><p>Error code: 501</p></body></html>';
    const because = await ask_a_server_that(
      async () =>
        new Response(page_of_a_plain_web_server, {
          status: 501,
          headers: { 'content-type': 'text/html;charset=utf-8' },
        }),
    );

    expect(because).toBe(
      'That address is a web page, not an MCP server (HTTP 501). Give the address of the MCP server itself. For most servers the address ends in /mcp.',
    );
  });

  it('decides by the answer and not by the status alone', async () => {
    const answers: Array<[Response, string]> = [
      [new Response('', { status: 501 }), 'is a web page, not an MCP server (HTTP 501)'],
      [
        new Response('<html><body>Bad gateway</body></html>', { status: 502 }),
        'is a web page, not an MCP server (HTTP 502)',
      ],
      [
        new Response('<!doctype html><title>Sign in</title>', { status: 400 }),
        'is a web page, not an MCP server (HTTP 400)',
      ],
      [
        new Response('<!doctype html><title>Welcome</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
        'is a web page, not an MCP server (HTTP 200)',
      ],
      [
        new Response('{"error":"overloaded"}', {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
        'The MCP server failed on its own side (HTTP 502)',
      ],
      [
        new Response('{"status":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
        'That address did not answer as an MCP server does (HTTP 200). Check the address.',
      ],
      [
        new Response('pong', { status: 200, headers: { 'content-type': 'text/plain' } }),
        'That address did not answer as an MCP server does (HTTP 200). Check the address.',
      ],
    ];

    for (const [answer, wanted] of answers) {
      expect(await ask_a_server_that(async () => answer.clone())).toContain(wanted);
    }
  });

  it('says to check the end of the address when the path is wrong', async () => {
    const because = await ask_a_server_that(async () => new Response('not found', { status: 404 }));

    expect(because).toBe(
      'Nothing answers as an MCP server at that address (HTTP 404). Check the end of the address. For most servers the address ends in /mcp.',
    );
  });

  it('says the server failed on its own side, and to try again', async () => {
    const because = await ask_a_server_that(async () => new Response('oops', { status: 503 }));

    expect(because).toBe(
      'The MCP server failed on its own side (HTTP 503). Try again in a minute. If it fails again, the people who run the server must look at it.',
    );
  });

  it('says to check the address for any other answer that is no success', async () => {
    const because = await ask_a_server_that(async () => new Response('', { status: 400 }));

    expect(because).toBe(
      'That address did not answer as an MCP server does (HTTP 400). Check the address. For most servers the address ends in /mcp.',
    );
  });

  it('says what to check when nothing answers, in no words of the runtime', async () => {
    const because = await ask_a_server_that(async () => {
      throw new Error('Unable to connect. Is the computer able to access the url?');
    });

    expect(because).toBe(
      'Alfera could not connect to that address. Check the spelling of the address and that the server is running, then try again.',
    );
  });

  it('says the server did not answer in time when the wait ran out', async () => {
    const because = await ask_a_server_that(fail_as('TimeoutError', 'The operation timed out.'));

    expect(because).toBe(
      'The MCP server did not answer in time. Check that the server is running, then try again.',
    );
  });
});
