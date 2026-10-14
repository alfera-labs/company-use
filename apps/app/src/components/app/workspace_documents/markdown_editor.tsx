import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { GuardedPicture } from '@/components/app/workspace_documents/guarded_picture_node';
import { MarkdownToolbar } from '@/components/app/workspace_documents/markdown_toolbar';

export function MarkdownEditor({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      GuardedPicture,
    ],
    content: text,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
    editorProps: {
      attributes: {
        class:
          'prose dark:prose-invert max-w-none min-h-64 px-6 py-6 outline-none prose-table:border-collapse prose-td:border prose-td:border-border prose-td:p-2 prose-th:border prose-th:border-border prose-th:p-2',
        'aria-label': 'Document editor',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
  });
  useEditorState({ editor, selector: ({ editor: current }) => current?.state });
  if (!editor) return <p className="p-6 text-sm text-muted-foreground">Opening editor…</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MarkdownToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
