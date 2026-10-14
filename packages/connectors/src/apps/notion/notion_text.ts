export type NotionRichTextSpan = { plain_text?: string | null };

export type NotionTitleValue = NotionRichTextSpan[] | Record<string, unknown> | null;

type NotionPropertyValue = {
  type?: string | null;
  title?: NotionTitleValue;
};

export type NotionPageProperties = Record<string, NotionPropertyValue>;

export function find_title_spans(title: NotionTitleValue | undefined) {
  return Array.isArray(title) ? title : null;
}

export function join_rich_text_to_plain_text(spans: NotionRichTextSpan[] | null | undefined) {
  return (spans ?? []).map((span) => span.plain_text ?? '').join('');
}

export function find_page_title(properties: NotionPageProperties | null | undefined) {
  const entries = Object.values(properties ?? {});
  const title_property =
    entries.find((property) => property.type === 'title') ??
    entries.find((property) => find_title_spans(property.title) !== null);
  return join_rich_text_to_plain_text(find_title_spans(title_property?.title));
}
