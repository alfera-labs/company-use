import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { new_chat_draft_key, read_chat_draft } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import {
  read_catalog_request_status,
  should_offer_website_fallback,
  type WebsiteFallbackConditions,
  WebsiteFallbackPanel,
} from '@/components/connections/website_fallback_panel';
import {
  build_website_task_request,
  start_website_task,
  website_browsing_guide_url,
} from '@/lib/website_task_request';

const zero_result_search: WebsiteFallbackConditions = {
  is_integrations_tab: true,
  search_query: 'AcmeBooking',
  catalog_status: 'success',
  matching_integration_count: 0,
};

describe('when the browser fallback is offered', () => {
  it('appears for a search that returned no integration', () => {
    expect(should_offer_website_fallback(zero_result_search)).toBe(true);
  });

  it('stays away when the search box is empty', () => {
    expect(should_offer_website_fallback({ ...zero_result_search, search_query: '' })).toBe(false);
    expect(should_offer_website_fallback({ ...zero_result_search, search_query: '   ' })).toBe(
      false,
    );
  });

  it('stays away while the catalog is still loading', () => {
    expect(
      should_offer_website_fallback({ ...zero_result_search, catalog_status: 'loading' }),
    ).toBe(false);
  });

  it('stays away when the catalog request failed', () => {
    expect(should_offer_website_fallback({ ...zero_result_search, catalog_status: 'error' })).toBe(
      false,
    );
  });

  it('never replaces real catalog results', () => {
    expect(
      should_offer_website_fallback({ ...zero_result_search, matching_integration_count: 1 }),
    ).toBe(false);
    expect(
      should_offer_website_fallback({ ...zero_result_search, matching_integration_count: 42 }),
    ).toBe(false);
  });

  it('stays away on the Connected tab', () => {
    expect(
      should_offer_website_fallback({ ...zero_result_search, is_integrations_tab: false }),
    ).toBe(false);
  });
});

describe('reading the catalog request outcome', () => {
  it('reports loading while the first page is in flight', () => {
    expect(read_catalog_request_status({ isLoading: true, isError: false })).toBe('loading');
  });

  it('reports loading while the previous answer stands in for an unanswered search', () => {
    expect(
      read_catalog_request_status({ isLoading: false, isError: false, isPlaceholderData: true }),
    ).toBe('loading');
  });

  it('reports error when the request failed', () => {
    expect(read_catalog_request_status({ isLoading: false, isError: true })).toBe('error');
  });

  it('reports success once the catalog answered, even with an empty answer', () => {
    expect(read_catalog_request_status({ isLoading: false, isError: false })).toBe('success');
  });

  it('never offers the fallback for a loading or failed request', () => {
    for (const query of [
      { isLoading: true, isError: false },
      { isLoading: false, isError: true },
    ]) {
      expect(
        should_offer_website_fallback({
          ...zero_result_search,
          catalog_status: read_catalog_request_status(query),
        }),
      ).toBe(false);
    }
  });
});

describe('the browser fallback panel', () => {
  const html = renderToStaticMarkup(
    createElement(WebsiteFallbackPanel, {
      website_name: 'AcmeBooking',
      on_use_website: () => undefined,
      learn_more_href: website_browsing_guide_url(),
    }),
  );

  it('names the website the person searched for', () => {
    expect(html).toContain('No connector needed.');
    expect(html).toContain('Alfera can open AcmeBooking and use the website.');
    expect(html).toContain('Use AcmeBooking');
  });

  it('sends the learn-more link to the browser page on the marketing site', () => {
    expect(website_browsing_guide_url()).toMatch(/\/product\/browser$/);
    expect(html).toContain(`href="${website_browsing_guide_url()}"`);
  });

  it('says what the browser does and what the person can review', () => {
    expect(html).toContain('Runs in a controlled browser');
    expect(html).toContain('You can review every action');
  });

  it('claims no finished browser connection', () => {
    expect(html).not.toContain('Connected');
    expect(html).not.toContain('Signed in');
  });
});

describe('the primary action', () => {
  beforeEach(() => {
    install_browser_storage();
    useChatDraftStore.setState({ draft_by_key: {} });
  });

  it('writes the request where the chat composer reads it, then opens the chat', () => {
    const route = start_website_task('AcmeBooking');

    expect(read_chat_draft(new_chat_draft_key)).toBe(
      'Use the AcmeBooking website for me. Open it in the browser, then tell me what you can do there.',
    );
    expect(useChatDraftStore.getState().draft_by_key[new_chat_draft_key]).toBe(
      build_website_task_request('AcmeBooking'),
    );
    expect(route).toBe('/chats');
  });

  it('trims the website name out of the request', () => {
    expect(build_website_task_request('  AcmeBooking  ')).toContain('the AcmeBooking website');
  });
});

function install_browser_storage() {
  const stored_values = new Map<string, string>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => stored_values.get(key) ?? null,
        setItem: (key: string, value: string) => stored_values.set(key, value),
        removeItem: (key: string) => stored_values.delete(key),
      },
    },
  });
}
