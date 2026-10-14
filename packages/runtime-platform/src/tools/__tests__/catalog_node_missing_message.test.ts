import { node_missing_message } from '@runtime-platform/tools/catalog_tool_execution';
import { describe, expect, it } from 'vitest';

describe('node_missing_message', () => {
  it('names a malformed node_key as malformed, not as a missing node', () => {
    const leaked = 'gmail-get_api_proxy-1">\n<parameter name="input">{"url": "https://x"}';
    const message = node_missing_message(leaked);

    expect(message).not.toContain('No catalog node was found');
    expect(message).toContain('not a valid node identifier');
    expect(message).toContain('Send node_key and input as separate arguments');
  });

  it('recovers the intended key from the leaked syntax and suggests it', () => {
    const leaked = 'gmail-get_api_proxy-1">\n<parameter name="input">{}';

    expect(node_missing_message(leaked)).toContain('Did you mean gmail-get_api_proxy-1?');
  });

  it('keeps the plain missing-node wording for a well-formed key', () => {
    const message = node_missing_message('gmail-get_email-1');

    expect(message).toBe('No catalog node was found for gmail-get_email-1.');
    expect(message).not.toContain('not a valid node identifier');
  });

  it('offers no suggestion when nothing usable precedes the bad syntax', () => {
    const message = node_missing_message('{"node_key": "gmail-find_email-1"}');

    expect(message).toContain('not a valid node identifier');
    expect(message).not.toContain('Did you mean');
  });
});
