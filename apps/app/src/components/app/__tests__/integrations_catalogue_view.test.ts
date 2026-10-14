import { describe, expect, it } from 'vitest';
import {
  integrations_search_placeholder,
  shows_the_app_list,
} from '@/components/app/integrations_catalogue_view';

describe('the integrations page of an install with no app catalogue', () => {
  it('claims no number of integrations in the search field', () => {
    expect(integrations_search_placeholder('integrations', false)).toBe('Search integrations');
    expect(integrations_search_placeholder('integrations', true)).toBe(
      'Search 3,000+ integrations',
    );
    expect(integrations_search_placeholder('connected', false)).toBe('Search connections');
  });

  it('says nothing under the notice when no app can connect, and answers a search', () => {
    expect(shows_the_app_list(false, '')).toBe(false);
    expect(shows_the_app_list(false, 'notion')).toBe(true);
    expect(shows_the_app_list(true, '')).toBe(true);
  });
});
