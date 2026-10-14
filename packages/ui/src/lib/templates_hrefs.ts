import type {
  TemplateFilterPatch,
  TemplatesHrefs,
} from '@coworker/ui/components/templates-catalog';

/**
 * The catalogue's URLs, built in one place so the app and the public site filter identically.
 *
 * Every filter is a query parameter on one path. A category and an app are two ways of narrowing
 * the same list and the query takes one facet, so picking one clears the other — which also stops
 * a visitor from reaching "Sales ∩ Xero" and finding it empty.
 */

export type TemplateFilterState = {
  q?: string | undefined;
  kind?: string | undefined;
  category?: string | undefined;
  app?: string | undefined;
  sort?: string | undefined;
};

export function build_templates_hrefs(input: {
  base: string;
  state: TemplateFilterState;
  listing?: (slug: string) => string;
}): TemplatesHrefs {
  const listing = input.listing ?? ((slug: string) => `${input.base}/${slug}`);
  return {
    catalog: input.base,
    listing,
    filter: (patch: TemplateFilterPatch) => {
      const next = apply_patch(input.state, patch);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
      }
      const query = params.toString();
      return query ? `${input.base}?${query}` : input.base;
    },
  };
}

function apply_patch(state: TemplateFilterState, patch: TemplateFilterPatch): TemplateFilterState {
  const next: TemplateFilterState = { ...state };
  if ('kind' in patch) next.kind = patch.kind ?? undefined;
  if ('sort' in patch) next.sort = patch.sort ?? undefined;
  if ('category' in patch) {
    next.category = patch.category ?? undefined;
    next.app = undefined;
  }
  if ('app' in patch) {
    next.app = patch.app ?? undefined;
    next.category = undefined;
  }
  return next;
}

/** The one facet the catalogue query takes, from the two axes the toolbar offers. */
export function read_facet(state: TemplateFilterState) {
  if (state.app) return { facet_kind: 'app' as const, facet_key: state.app };
  if (state.category) return { facet_kind: 'category' as const, facet_key: state.category };
  return { facet_kind: null, facet_key: null };
}
