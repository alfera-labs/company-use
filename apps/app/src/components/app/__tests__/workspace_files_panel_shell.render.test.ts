import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatSessionGrid } from '@/components/app/chat_session_layout';
import {
  chat_min_width_beside_files_panel,
  width_that_leaves_room_for_the_chat,
} from '@/components/app/chat_ui_store';
import {
  FileDownloadIconLink,
  FileDownloadLink,
} from '@/components/app/workspace_file_download_link';
import { WorkspaceFilesPanel } from '@/components/app/workspace_files_panel';
import { query_keys } from '@/lib/api/query_keys';

const no_views = { render_file: () => null, render_listing: () => null, browser: null };

function panel_header_on_an_install(sandbox_shows_a_live_browser: boolean | undefined) {
  const client = new QueryClient();
  if (sandbox_shows_a_live_browser !== undefined) {
    client.setQueryData(query_keys.onboarding(), { install: { sandbox_shows_a_live_browser } });
  }
  const panel = createElement(WorkspaceFilesPanel, {
    onClose: () => {},
    sandboxPreviews: [],
    session_id: 'ses_1',
    workspace_id: 'ws_1',
    file_views: no_views,
  });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, panel));
  return html.slice(html.indexOf('<header'), html.indexOf('</header>'));
}

describe('the tabs of the Files panel', () => {
  it('offers no Browser tab where the sandbox has no browser to show', () => {
    const header = panel_header_on_an_install(false);

    expect(header).not.toMatch(/browser/iu);
    expect(header).toContain('>Files<');
  });

  it('offers Files and Browser where the sandbox has one', () => {
    const header = panel_header_on_an_install(true);

    expect(header).toMatch(/>files<\/button>/u);
    expect(header).toMatch(/>browser<\/button>/u);
  });
});

describe('the download link of a file', () => {
  const html = renderToStaticMarkup(
    createElement(FileDownloadIconLink, { file_path: 'files/data.json' }),
  );

  it('is a link that downloads the file under its own name', () => {
    expect(html).toMatch(/^<a /u);
    expect(html).toContain('download="data.json"');
    expect(html).toContain('aria-label="Download file"');
  });

  it('shows its icon', () => {
    expect(html).toContain('<svg');
  });

  it('shows the icon beside the words on the button of a file with no preview', () => {
    const button = renderToStaticMarkup(
      createElement(FileDownloadLink, { file_path: 'files/archive.zip' }),
    );

    expect(button).toContain('<svg');
    expect(button).toContain('Download file');
  });
});

describe('the width of the Files panel beside the chat', () => {
  it('stops where the chat would get narrower than its minimum', () => {
    expect(width_that_leaves_room_for_the_chat(960, 1032)).toBe(632);
    expect(width_that_leaves_room_for_the_chat(500, 1032)).toBe(500);
  });

  it('is not held back when the room is not known', () => {
    expect(width_that_leaves_room_for_the_chat(960)).toBe(960);
  });

  it('gives the chat column the same minimum in the layout, whatever width is stored', () => {
    const chat_beside_a_wide_panel = ChatSessionGrid({
      files_panel_open: true,
      files_panel_width: 960,
      shows_artifact_panel: false,
      children: null,
    });
    const grid = renderToStaticMarkup(chat_beside_a_wide_panel);

    expect(grid).toContain(`minmax(${chat_min_width_beside_files_panel}px,1fr)`);
    expect(grid).toContain('minmax(0,var(--files-panel-width))');
  });
});
