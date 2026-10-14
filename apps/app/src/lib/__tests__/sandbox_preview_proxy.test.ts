import { describe, expect, it } from 'vitest';
import { is_sandbox_preview_host, is_static_asset_request } from '@/lib/sandbox_preview_proxy';

describe('sandbox preview proxy routing', () => {
  it('only treats subdomains of the sandbox base domain as preview hosts', () => {
    expect(is_sandbox_preview_host('demo.sandboxes.alfera.ai', 'sandboxes.alfera.ai')).toBe(true);
    expect(is_sandbox_preview_host('sandboxes.alfera.ai', 'sandboxes.alfera.ai')).toBe(false);
    expect(is_sandbox_preview_host('app.alfera.ai', 'sandboxes.alfera.ai')).toBe(false);
  });

  it('lets the client bundle through the session gate', () => {
    expect(is_static_asset_request('/_build/assets/client-abc123.js')).toBe(true);
    expect(is_static_asset_request('/assets/app-abc123.css')).toBe(true);
  });

  it('keeps product-host static assets out of AuthKit handling', () => {
    expect(is_static_asset_request('/logos/other_agent.png')).toBe(true);
    expect(is_static_asset_request('/logos/claude.png')).toBe(true);
    expect(is_static_asset_request('/document-viewers/word_editor.wasm')).toBe(true);
    expect(is_static_asset_request('/document-viewers/spreadsheet_viewer.wasm')).toBe(true);
    expect(is_static_asset_request('/pptx-react-viewer.css')).toBe(true);
    expect(is_static_asset_request('/document-viewer-licenses/react-docx.txt')).toBe(true);
    expect(is_static_asset_request('/favicon.ico')).toBe(true);
    expect(is_static_asset_request('/chats/ses_123')).toBe(false);
  });

  it('no longer opens the Next.js asset prefixes', () => {
    expect(is_static_asset_request('/_next/static/chunks/app.js')).toBe(false);
    expect(is_static_asset_request('/_next/image')).toBe(false);
  });
});
