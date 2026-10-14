/**
 * The categories on /templates, in display order.
 *
 * A registry rather than a table: the labels are editorial, they change with the copy and not with
 * the data, and a listing joins a category by writing one facet in its sidecar.
 */

export type TemplateCategoryDefinition = {
  facet_key: string;
  title: string;
};

export const template_categories: TemplateCategoryDefinition[] = [
  { facet_key: 'sales', title: 'Sales' },
  { facet_key: 'support', title: 'Support' },
  { facet_key: 'operations', title: 'Operations' },
  { facet_key: 'finance', title: 'Finance' },
  { facet_key: 'events', title: 'Events' },
];

const categories_by_key = new Map(
  template_categories.map((category) => [category.facet_key, category]),
);

export function find_template_category(facet_key: string) {
  return categories_by_key.get(facet_key) ?? null;
}

/** The heading the catalogue shows, whichever axis it is filtered on. */
export function describe_catalog_heading(input: {
  facet_kind: 'category' | 'role' | 'app' | 'topic' | null;
  facet_key: string | null;
  query?: string | null;
}) {
  if (input.query) return `“${input.query}”`;
  if (!input.facet_key) return 'All templates';
  if (input.facet_kind === 'role') return `For ${humanize(input.facet_key)}`;
  if (input.facet_kind === 'app') return `Works with ${humanize(input.facet_key)}`;
  return find_template_category(input.facet_key)?.title ?? humanize(input.facet_key);
}

function humanize(facet_key: string) {
  return facet_key
    .split(/[-_]/u)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
