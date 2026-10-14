import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Undo2,
} from 'lucide-react';
import { useId, useState } from 'react';

export function MarkdownToolbar({ editor }: { editor: Editor }) {
  const link_input_id = useId();
  const [link_open, set_link_open] = useState(false);
  const [link_url, set_link_url] = useState('');
  const [link_error, set_link_error] = useState('');
  const tools = [
    {
      label: 'Bold',
      Icon: Bold,
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      Icon: Italic,
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Strikethrough',
      Icon: Strikethrough,
      active: editor.isActive('strike'),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: 'Heading 1',
      Icon: Heading1,
      active: editor.isActive('heading', { level: 1 }),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      Icon: Heading2,
      active: editor.isActive('heading', { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Bullet list',
      Icon: List,
      active: editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      Icon: ListOrdered,
      active: editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Checklist',
      Icon: CheckSquare,
      active: editor.isActive('taskList'),
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: 'Quote',
      Icon: Quote,
      active: editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Code block',
      Icon: Code,
      active: editor.isActive('codeBlock'),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: 'Insert table',
      Icon: Table,
      active: editor.isActive('table'),
      run: () =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      label: 'Undo',
      Icon: Undo2,
      active: false,
      disabled: !editor.can().undo(),
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: 'Redo',
      Icon: Redo2,
      active: false,
      disabled: !editor.can().redo(),
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  const set_link = () => {
    const href = link_url.trim();
    if (!href) {
      editor.chain().focus().unsetLink().run();
      set_link_open(false);
      return;
    }
    try {
      const url = new URL(href);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol))
        throw new Error('Unsupported link');
    } catch {
      set_link_error('Enter a full https://, http://, or mailto: link.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    set_link_open(false);
  };
  return (
    <div className="shrink-0">
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="flex flex-wrap gap-0.5 border-b border-border px-3 py-2"
      >
        {tools.map(({ label, Icon, active, disabled, run }) => (
          <Button
            key={label}
            aria-label={label}
            title={label}
            aria-pressed={active}
            size="icon-sm"
            variant={active ? 'secondary' : 'ghost'}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
          >
            <Icon className="size-4" />
          </Button>
        ))}
        <Button
          aria-label="Add link"
          title="Add link"
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            set_link_url(editor.getAttributes('link').href ?? 'https://');
            set_link_error('');
            set_link_open(!link_open);
          }}
        >
          <Link className="size-4" />
        </Button>
      </div>
      {link_open ? (
        <form
          className="space-y-2 border-b border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            set_link();
          }}
        >
          <label className="block text-xs font-medium" htmlFor={link_input_id}>
            Link URL
          </label>
          <div className="flex gap-2">
            <Input
              id={link_input_id}
              value={link_url}
              onChange={(event) => set_link_url(event.target.value)}
              aria-invalid={Boolean(link_error)}
            />
            <Button size="sm" type="submit">
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                set_link_open(false);
                editor.commands.focus();
              }}
            >
              Cancel
            </Button>
          </div>
          {link_error ? (
            <p role="alert" className="text-xs text-destructive">
              {link_error}
            </p>
          ) : null}
        </form>
      ) : null}
      {editor.isActive('table') ? (
        <div
          role="toolbar"
          aria-label="Table editing"
          className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5"
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            Add row
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            Delete row
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            Add column
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            Delete column
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Delete table
          </Button>
        </div>
      ) : null}
    </div>
  );
}
