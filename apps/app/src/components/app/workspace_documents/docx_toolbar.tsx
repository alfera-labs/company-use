import { Button } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import type { DocxEditorController } from '@extend-ai/react-docx';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  MoreHorizontal,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const font_families = [
  'Arial',
  'Calibri',
  'Courier New',
  'Georgia',
  'Tahoma',
  'Times New Roman',
  'Verdana',
];
const highlight_colors = ['yellow', 'green', 'cyan', 'magenta', 'red', 'blue'] as const;
const highlight_swatch_colors = {
  yellow: '#fff59d',
  green: '#bbf7d0',
  cyan: '#a5f3fc',
  magenta: '#f5d0fe',
  red: '#fecaca',
  blue: '#bfdbfe',
};

export function DocxToolbar({
  editor,
  editable,
}: {
  editor: DocxEditorController;
  editable: boolean;
}) {
  const [show_link_input, set_show_link_input] = useState(false);
  const active_style = editor.selectedRunStyle ?? editor.pendingRunStyle;
  if (!editable) return null;
  return (
    <div className="border-b border-border bg-background px-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 basis-80 grow items-center gap-1">
          <ParagraphStyleSelect editor={editor} />
          <FontFamilySelect editor={editor} font_family={active_style?.fontFamily} />
          <FontSizeInput editor={editor} font_size={active_style?.fontSizePt} />
        </div>
        <div className="flex min-w-0 items-center gap-0.5">
          <ToolbarButton
            active={Boolean(active_style?.bold)}
            label="Bold"
            onClick={editor.toggleBold}
          >
            <Bold />
          </ToolbarButton>
          <ToolbarButton
            active={Boolean(active_style?.italic)}
            label="Italic"
            onClick={editor.toggleItalic}
          >
            <Italic />
          </ToolbarButton>
          <ToolbarButton
            active={Boolean(active_style?.underline)}
            label="Underline"
            onClick={editor.toggleUnderline}
          >
            <Underline />
          </ToolbarButton>
          <ColorInput
            label="Text color"
            value={active_style?.color}
            onChange={editor.setTextColor}
          />
          <HighlightMenu editor={editor} active_highlight={active_style?.highlight} />
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <ToolbarButton
            active={editor.hasUnorderedList}
            label="Bulleted list"
            onClick={() => editor.toggleList('unordered')}
          >
            <List />
          </ToolbarButton>
          <ToolbarButton
            active={editor.hasOrderedList}
            label="Numbered list"
            onClick={() => editor.toggleList('ordered')}
          >
            <ListOrdered />
          </ToolbarButton>
          <MoreFormatting editor={editor} onShowLink={() => set_show_link_input(true)} />
          <span className="ml-auto flex items-center gap-0.5">
            <ToolbarButton label="Undo" disabled={!editor.canUndo} onClick={editor.undo}>
              <Undo2 />
            </ToolbarButton>
            <ToolbarButton label="Redo" disabled={!editor.canRedo} onClick={editor.redo}>
              <Redo2 />
            </ToolbarButton>
          </span>
        </div>
      </div>
      {show_link_input ? (
        <LinkEditor editor={editor} onClose={() => set_show_link_input(false)} />
      ) : null}
    </div>
  );
}

function ParagraphStyleSelect({ editor }: { editor: DocxEditorController }) {
  return (
    <select
      aria-label="Paragraph style"
      className="h-7 min-w-0 max-w-36 flex-1 rounded-2xl border border-border bg-background px-2 text-xs"
      value={editor.selectedParagraphStyleId ?? ''}
      onChange={(event) => editor.setParagraphStyle(event.target.value || undefined)}
    >
      <option value="">Default</option>
      {editor.availableParagraphStyles.map((style) => (
        <option key={style.id} value={style.id}>
          {style.name ?? style.id}
        </option>
      ))}
    </select>
  );
}

function FontFamilySelect({
  editor,
  font_family,
}: {
  editor: DocxEditorController;
  font_family: string | undefined;
}) {
  const choices =
    font_family && !font_families.includes(font_family)
      ? [font_family, ...font_families]
      : font_families;
  return (
    <select
      aria-label="Font family"
      className="h-7 min-w-0 max-w-40 flex-1 rounded-2xl border border-border bg-background px-2 text-xs"
      value={font_family ?? ''}
      onChange={(event) => editor.setFontFamily(event.target.value)}
    >
      <option disabled value="">
        Theme font
      </option>
      {choices.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>
  );
}

function FontSizeInput({
  editor,
  font_size,
}: {
  editor: DocxEditorController;
  font_size: number | undefined;
}) {
  const selected_size = font_size ? String(font_size) : '';
  const [input, set_input] = useState(selected_size);
  useEffect(() => set_input(selected_size), [selected_size]);
  const commit = (value: string) => {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 1 || size > 400 || !Number.isInteger(size * 2)) {
      return set_input(selected_size);
    }
    if (size === font_size) return set_input(String(size));
    editor.setFontSize(size);
    set_input(String(size));
  };
  return (
    <input
      aria-label="Font size in points"
      className="h-7 w-12 rounded-2xl border border-border bg-background px-1 text-center text-xs tabular-nums"
      inputMode="decimal"
      max="400"
      min="1"
      placeholder="Size"
      step="0.5"
      type="number"
      value={input}
      onBlur={(event) => commit(event.currentTarget.value)}
      onChange={(event) => set_input(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.currentTarget.value = selected_size;
          set_input(selected_size);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (color: string) => void;
}) {
  const normalized_value = value?.replace(/^#/, '');
  const color =
    normalized_value && /^[\da-f]{6}$/i.test(normalized_value) ? `#${normalized_value}` : '#111827';
  return (
    <label
      className="relative flex size-7 cursor-pointer items-center justify-center rounded-2xl hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
      title={label}
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className="flex flex-col items-center text-sm font-semibold text-foreground"
      >
        <span>A</span>
        <span
          className="h-1 w-3 rounded-lg border border-border"
          style={{ backgroundColor: color }}
        />
      </span>
      <input
        className="absolute inset-0 size-full min-w-0 cursor-pointer opacity-0"
        type="color"
        value={color}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function HighlightMenu({
  editor,
  active_highlight,
}: {
  editor: DocxEditorController;
  active_highlight: string | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Highlight color"
            size="icon-sm"
            type="button"
            variant={active_highlight ? 'secondary' : 'ghost'}
          />
        }
      >
        <Highlighter />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        {highlight_colors.map((color) => (
          <DropdownMenuItem key={color} onClick={() => editor.setHighlight(color)}>
            <span
              aria-hidden="true"
              className="size-3 rounded-lg border border-border"
              style={{ backgroundColor: highlight_swatch_colors[color] }}
            />
            <span className="capitalize">{color}</span>
            {active_highlight === color ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => editor.setHighlight(undefined)}>
          No highlight
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MoreFormatting({
  editor,
  onShowLink,
}: {
  editor: DocxEditorController;
  onShowLink: () => void;
}) {
  const character_actions = [
    ['Strikethrough', Strikethrough, editor.toggleStrike],
    ['Superscript', Superscript, editor.toggleSuperscript],
    ['Subscript', Subscript, editor.toggleSubscript],
  ] as const;
  const alignment_actions = [
    ['Align left', AlignLeft, () => editor.setAlignment('left')],
    ['Align center', AlignCenter, () => editor.setAlignment('center')],
    ['Align right', AlignRight, () => editor.setAlignment('right')],
    ['Justify', AlignJustify, () => editor.setAlignment('justify')],
  ] as const;
  const spacing_actions = [
    ['Single spacing', null, () => editor.setLineSpacing(1)],
    ['1.5 spacing', null, () => editor.setLineSpacing(1.5)],
    ['Double spacing', null, () => editor.setLineSpacing(2)],
  ] as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label="More formatting" size="icon-sm" type="button" variant="ghost" />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>More formatting</DropdownMenuLabel>
        {character_actions.map(([label, Icon, action]) => (
          <DropdownMenuItem key={label} onClick={action}>
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {alignment_actions.map(([label, Icon, action]) => (
          <DropdownMenuItem key={label} onClick={action}>
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {spacing_actions.map(([label, , action]) => (
          <DropdownMenuItem key={label} onClick={action}>
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onShowLink}>
          <Link />
          {editor.selectedLink ? 'Edit link' : 'Add link'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={editor.insertTable}>
          <Table2 />
          Insert table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinkEditor({ editor, onClose }: { editor: DocxEditorController; onClose: () => void }) {
  const [link, set_link] = useState(editor.selectedLink ?? 'https://');
  const apply_link = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('docx-link') as HTMLInputElement;
    try {
      const url = new URL(link);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error();
      input.setCustomValidity('');
      editor.setLink(link);
      onClose();
    } catch {
      input.setCustomValidity('Enter an HTTP, HTTPS, or email link.');
      input.reportValidity();
    }
  };
  return (
    <form
      className="mt-1 flex items-center gap-1 border-t border-border pt-1"
      onSubmit={apply_link}
    >
      <input
        aria-label="Link URL"
        className="h-7 min-w-0 flex-1 rounded-2xl border border-border bg-background px-2 text-xs"
        name="docx-link"
        type="url"
        value={link}
        onChange={(event) => {
          event.currentTarget.setCustomValidity('');
          set_link(event.target.value);
        }}
      />
      <Button size="xs" type="submit" variant="outline">
        Apply
      </Button>
      {editor.selectedLink ? (
        <Button
          size="xs"
          type="button"
          variant="ghost"
          onClick={() => {
            editor.setLink(undefined);
            onClose();
          }}
        >
          Remove
        </Button>
      ) : null}
    </form>
  );
}

function ToolbarButton({
  active,
  label,
  onMouseDown,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean; label: string }) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      title={label}
      size="icon-sm"
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown?.(event);
      }}
      {...props}
    />
  );
}
