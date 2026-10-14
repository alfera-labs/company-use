import { Button } from '@coworker/ui/components/button';
import { Textarea } from '@coworker/ui/components/textarea';
import { useState } from 'react';
import { client_only_lazy } from '@/components/client_only_lazy';

const MarkdownEditor = client_only_lazy(async () => ({
  default: (await import('@/components/app/workspace_documents/markdown_editor')).MarkdownEditor,
}));

export function WorkspaceTextEditor({
  text,
  markdown,
  onChange,
}: {
  text: string;
  markdown: boolean;
  onChange: (text: string) => void;
}) {
  // Preserve extensions the visual editor cannot round-trip. Source remains available for every document.
  const requires_source = /(^---\r?\n|<!--|<\/?[a-zA-Z]|^\[\^[^\]]+\]:|^\$\$|^:::)/mu.test(text);
  const [source, set_source] = useState(!markdown || requires_source);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {markdown ? (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
          <Button
            size="sm"
            variant={!source ? 'secondary' : 'ghost'}
            disabled={requires_source}
            onClick={() => set_source(false)}
          >
            Visual
          </Button>
          <Button
            size="sm"
            variant={source ? 'secondary' : 'ghost'}
            onClick={() => set_source(true)}
          >
            Source
          </Button>
          {requires_source ? (
            <span className="text-xs text-muted-foreground">
              Source preserves this document’s formatting.
            </span>
          ) : null}
        </div>
      ) : null}
      {source ? (
        <Textarea
          aria-label="File source"
          spellCheck={markdown}
          className="min-h-0 flex-1 resize-none rounded-none border-0 px-6 py-6 font-mono text-sm leading-6 focus-visible:ring-0"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <MarkdownEditor text={text} onChange={onChange} />
      )}
    </div>
  );
}
