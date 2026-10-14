import { cn } from '@coworker/ui/lib/utils';
import { memo, useEffect, useMemo, useSyncExternalStore } from 'react';
import { type Components, Streamdown, type StreamdownProps } from 'streamdown';
import '@/components/app/chat_streamed_text.css';
import {
  FoldersInTheTextProvider,
  picture_components,
} from '@/components/prompt-kit/answer_picture';
import {
  rewrite_sandbox_file_links,
  useOpenWorkspaceFile,
  workspace_file_path_from_href,
} from '@/components/prompt-kit/markdown_file_links';
import {
  CodeWithWorkspaceFilePath,
  markdown_link_class_name,
  TextWithWorkspaceFilePaths,
} from '@/components/prompt-kit/markdown_file_paths';
import {
  markdown_plugins_needed,
  read_markdown_plugins,
  read_text_markdown_plugins,
  request_markdown_plugins,
  subscribe_to_markdown_plugins,
  subscribe_to_text_markdown_plugins,
} from '@/components/prompt-kit/markdown_plugins';
import {
  markdown_blockquote_class_name,
  markdown_container_class_name,
  markdown_h1_class_name,
  markdown_h2_class_name,
  markdown_h3_class_name,
  markdown_li_class_name,
  markdown_ol_class_name,
  markdown_paragraph_class_name,
  markdown_ul_class_name,
} from '@/components/prompt-kit/markdown_styles';
import { rehype_steps, remark_steps } from '@/components/prompt-kit/markdown_tree_steps';
import { workspace_folders_named_in } from '@/components/prompt-kit/picture_source';

type MarkdownProps = {
  children: string;
  className?: string;
  components?: Partial<Components>;
  isStreaming?: boolean;
};

const streamed_word_fade: NonNullable<StreamdownProps['animated']> = { sep: 'word', stagger: 0 };

const default_components: Partial<Components> = {
  p: function PComponent({ className, children }) {
    return (
      <p className={cn(markdown_paragraph_class_name, className)}>
        <TextWithWorkspaceFilePaths>{children}</TextWithWorkspaceFilePaths>
      </p>
    );
  },
  h1: function H1Component({ className, children }) {
    return <h1 className={cn(markdown_h1_class_name, className)}>{children}</h1>;
  },
  h2: function H2Component({ className, children }) {
    return <h2 className={cn(markdown_h2_class_name, className)}>{children}</h2>;
  },
  h3: function H3Component({ className, children }) {
    return <h3 className={cn(markdown_h3_class_name, className)}>{children}</h3>;
  },
  ul: function UlComponent({ className, children }) {
    return <ul className={cn(markdown_ul_class_name, className)}>{children}</ul>;
  },
  ol: function OlComponent({ className, children }) {
    return <ol className={cn(markdown_ol_class_name, className)}>{children}</ol>;
  },
  li: function LiComponent({ className, children }) {
    return (
      <li className={cn(markdown_li_class_name, className)}>
        <TextWithWorkspaceFilePaths>{children}</TextWithWorkspaceFilePaths>
      </li>
    );
  },
  strong: function StrongComponent({ className, children }) {
    return (
      <span className={cn('font-semibold', className)} data-streamdown="strong">
        <TextWithWorkspaceFilePaths>{children}</TextWithWorkspaceFilePaths>
      </span>
    );
  },
  blockquote: function BlockquoteComponent({ className, children }) {
    return (
      <blockquote className={cn(markdown_blockquote_class_name, className)}>{children}</blockquote>
    );
  },
  inlineCode: function InlineCodeComponent({ className, children }) {
    return (
      <span className={cn('rounded-lg bg-muted px-1 font-mono text-sm', className)}>
        <CodeWithWorkspaceFilePath>{children}</CodeWithWorkspaceFilePath>
      </span>
    );
  },
  a: function AComponent({ href, children }) {
    const open_workspace_file = useOpenWorkspaceFile();
    if (!href) return <span>{children}</span>;
    const workspace_file_path = open_workspace_file ? workspace_file_path_from_href(href) : null;
    if (open_workspace_file && workspace_file_path) {
      return (
        <button
          className={markdown_link_class_name}
          type="button"
          onClick={() => open_workspace_file(workspace_file_path)}
        >
          {children}
        </button>
      );
    }
    return (
      <a className={markdown_link_class_name} href={href} {...markdown_link_target_props(href)}>
        {children}
      </a>
    );
  },
};

function markdown_link_target_props(href: string) {
  if (!is_http_link(href)) return {};
  return { rel: 'noreferrer', target: '_blank' };
}

function is_http_link(href: string) {
  return /^https?:\/\//iu.test(href);
}

const Markdown = memo(
  function Markdown({
    children,
    className,
    components = default_components,
    isStreaming = false,
  }: MarkdownProps) {
    const needed_plugins = useMemo(() => markdown_plugins_needed(children), [children]);
    const needs_plugins = needed_plugins.length > 0;

    const plugins = useSyncExternalStore(
      needs_plugins ? subscribe_to_markdown_plugins : subscribe_to_text_markdown_plugins,
      needs_plugins ? read_markdown_plugins : read_text_markdown_plugins,
      read_text_markdown_plugins,
    );

    useEffect(() => {
      if (needed_plugins.length > 0) request_markdown_plugins(needed_plugins);
    }, [needed_plugins]);
    const guarded_components = useMemo(
      () => ({ ...components, ...picture_components }),
      [components],
    );
    const folders = useMemo(() => workspace_folders_named_in(children), [children]);

    return (
      <FoldersInTheTextProvider value={folders}>
        <Streamdown
          className={cn(markdown_container_class_name, className)}
          components={guarded_components}
          plugins={plugins}
          rehypePlugins={rehype_steps}
          remarkPlugins={remark_steps}
          animated={isStreaming ? streamed_word_fade : false}
          isAnimating={isStreaming}
        >
          {rewrite_sandbox_file_links(children)}
        </Streamdown>
      </FoldersInTheTextProvider>
    );
  },
  (previous, next) =>
    previous.children === next.children &&
    previous.className === next.className &&
    previous.components === next.components &&
    previous.isStreaming === next.isStreaming,
);

export { Markdown };
