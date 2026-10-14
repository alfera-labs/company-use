import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import * as Sentry from '@sentry/tanstackstart-react';
import { Check, Copy } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { copy_text } from '@/lib/copy_text';

function CodeBlock({ className, ...props }: React.HTMLProps<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'not-prose flex w-full flex-col overflow-clip rounded-2xl border border-border bg-card text-card-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockCode({
  className,
  code,
  language = 'tsx',
}: React.HTMLProps<HTMLDivElement> & { code: string; language?: string }) {
  const { resolvedTheme } = useTheme();
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    void import('shiki')
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: language,
          theme: resolvedTheme === 'dark' ? 'github-dark' : 'github-light',
        }).then((html) => {
          if (isCurrent) setHighlightedHtml(html);
        }),
      )
      .catch((error) => {
        Sentry.captureException(error);
      });
    return () => {
      isCurrent = false;
    };
  }, [code, language, resolvedTheme]);

  const class_names = cn(
    'w-full overflow-x-auto text-[13px] [&>pre]:!bg-background [&>pre]:px-4 [&>pre]:py-4',
    className,
  );

  if (highlightedHtml) {
    // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki returns escaped code highlighting HTML.
    return <div className={class_names} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />;
  }

  return (
    <div className={class_names}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function CodeBlockHeader({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function copy_code() {
    try {
      await copy_text(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    } catch (error) {
      toast.error(format_error_message(error, 'Could not copy code'));
    }
  }

  return (
    <div className="flex h-9 items-center justify-between border-b px-3">
      <div className="font-mono text-xs text-muted-foreground">{language}</div>
      <Button
        className="h-7 px-2 text-xs"
        size="sm"
        type="button"
        variant="ghost"
        onClick={copy_code}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export { CodeBlock, CodeBlockCode, CodeBlockHeader };
