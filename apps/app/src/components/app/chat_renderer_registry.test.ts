import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  artifact_content_text,
  artifact_renderer_key_for_content,
} from '@/components/app/artifact_renderer_selection';
import { GenerativeUiRenderer } from '@/components/app/generative_ui_renderer';
import { json_render_spec_from_value } from '@/components/app/generative_ui_spec';
import type { ArtifactContent } from '@/lib/api';

describe('chat renderer registries', () => {
  it('selects artifact renderers from kind, mime type, extension, and content', () => {
    expect(artifact_renderer_key_for_content(artifact_content({ file_purpose: 'json' }))).toBe(
      'json',
    );
    expect(
      artifact_renderer_key_for_content(
        artifact_content({ file_purpose: 'file', file_name: 'report.csv' }),
      ),
    ).toBe('sheet');
    expect(
      artifact_renderer_key_for_content(
        artifact_content({ file_purpose: 'file', mime_type: 'text/html' }),
      ),
    ).toBe('html');
    expect(
      artifact_renderer_key_for_content(
        artifact_content({ file_purpose: 'file', content_text: '{"ok":true}' }),
      ),
    ).toBe('json');
  });

  it('reads artifact text from content before preview', () => {
    expect(
      artifact_content_text(
        artifact_content({ content_preview: 'preview', content_text: 'downloaded bytes' }),
      ),
    ).toBe('downloaded bytes');
  });

  it('accepts bare and wrapped json-render specs', () => {
    const spec = {
      root: 'root',
      elements: {
        root: { type: 'Text', props: { text: 'Ready' }, children: [] },
      },
    };

    expect(json_render_spec_from_value(spec)?.root).toBe('root');
    expect(json_render_spec_from_value({ spec })?.root).toBe('root');
    expect(json_render_spec_from_value({ elements: {} })).toBeNull();
  });

  it('renders a json-render generated UI spec through the real registry', () => {
    const spec = {
      root: 'root',
      elements: {
        root: { type: 'Text', props: { text: 'Ready' }, children: [] },
      },
    };

    const markup = renderToStaticMarkup(createElement(GenerativeUiRenderer, { uiSpec: spec }));

    expect(markup).toContain('Generated UI');
    expect(markup).toContain('Ready');
  });
});

function artifact_content(
  overrides: Partial<ArtifactContent['file']> & {
    content_preview?: string | null;
    content_text?: string | null;
  },
): ArtifactContent {
  return {
    file: {
      file_id: 'art_1',
      file_purpose: overrides.file_purpose ?? 'file',
      file_metadata: {},
      file_status: 'ready',
      byte_size: 12,
      checksum_sha256: null,
      content_preview: overrides.content_preview ?? null,
      created_by: 'system',
      created_time: '2026-06-16T00:00:00.000Z',
      file_name: overrides.file_name ?? null,
      is_visible: true,
      last_updated_by: 'system',
      last_updated_time: '2026-06-16T00:00:00.000Z',
      mime_type: overrides.mime_type ?? null,
      run_id: null,
      runtime_environment_id: null,
      session_id: null,
      source_tool_call_id: null,
      storage_key: overrides.storage_key ?? 'artifacts/output.txt',
      storage_provider: 'local_workspace',
      workspace_id: 'wsp_1',
      workspace_path: overrides.workspace_path ?? null,
      ...overrides,
    },
    byte_size: 12,
    checksum_sha256: 'sha',
    content_text: overrides.content_text ?? null,
  } as ArtifactContent;
}
