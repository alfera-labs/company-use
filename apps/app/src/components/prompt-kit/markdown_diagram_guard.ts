type MarkdownTreeNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownTreeNode[];
};

const diagram_class_name = 'language-mermaid';

const fetching_diagram_pattern =
  /:\/\/|\/\/[\w[]|url\s*\(|@import|%%\s*\{|\bimg\s*:|<\s*(?!br\b)[a-z!]/iu;

/**
 * True when drawing this diagram source could send a request the person did not ask for. The
 * source can make the browser fetch by itself with an address, a picture shape, a style with
 * `url(`, a settings line, or an HTML tag other than a line break.
 */
export function diagram_source_can_fetch(source: string) {
  return fetching_diagram_pattern.test(source);
}

/**
 * A markdown tree step that shows a diagram as its source text, not as a drawing, when drawing
 * it could fetch from another site. The diagram library loads such addresses with no click, and
 * an address can carry private text.
 */
export function show_fetching_diagrams_as_text() {
  return function guard_diagrams(node: MarkdownTreeNode) {
    const class_names = node.properties?.className;
    if (node.tagName === 'code' && Array.isArray(class_names)) {
      const source = (node.children ?? []).map((child) => child.value ?? '').join('');
      if (class_names.includes(diagram_class_name) && diagram_source_can_fetch(source)) {
        node.properties = { ...node.properties, className: ['language-text'] };
      }
    }
    for (const child of node.children ?? []) guard_diagrams(child);
  };
}
