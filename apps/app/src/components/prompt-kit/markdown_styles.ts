export const markdown_container_class_name =
  'flex min-w-0 max-w-full flex-col gap-2 overflow-hidden [&>*:first-child]:mt-0 [&>*:last-child]:mb-0';

export const markdown_paragraph_class_name = 'm-0 leading-6';
export const markdown_h1_class_name = 'm-0 text-lg font-semibold leading-7';
export const markdown_h2_class_name = 'm-0 text-base font-semibold leading-7';
export const markdown_h3_class_name = 'm-0 text-sm font-semibold leading-6';
export const markdown_ul_class_name = 'my-0 list-disc space-y-1.5 pl-5';
// pl-8 (not pl-5): the container clips overflow, and an outside `list-decimal`
// marker for items 10+ is wider than pl-5's 20px, so its first digit overflowed
// left and got cut ("10." rendered as "0."). 32px holds 2–3 digit markers.
export const markdown_ol_class_name = 'my-0 list-decimal space-y-2 pl-8';
export const markdown_li_class_name =
  'pl-1 marker:text-muted-foreground [&>ol]:mt-2 [&>p]:m-0 [&>p+p]:mt-1 [&>ul]:mt-2';
export const markdown_blockquote_class_name =
  'my-0 border-l-2 border-border pl-3 text-muted-foreground';
