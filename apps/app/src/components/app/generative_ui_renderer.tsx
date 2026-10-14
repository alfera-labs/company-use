import { Badge } from '@coworker/ui/components/badge';
import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import { defineCatalog, validateSpec } from '@json-render/core';
import {
  type BaseComponentProps,
  type ComponentRenderProps,
  defineRegistry,
  JSONUIProvider,
  Renderer,
} from '@json-render/react';
import { schema } from '@json-render/react/schema';
import { AlertTriangle } from 'lucide-react';
import { z } from 'zod';
import { json_render_spec_from_value } from '@/components/app/generative_ui_spec';
import { Markdown } from '@/components/prompt-kit/markdown';

type GenerativeUiRendererProps = {
  isStreaming?: boolean;
  rendererKey?: string;
  uiSpec: unknown;
  uiSpecFormat?: string;
};

const generative_ui_catalog = defineCatalog(schema, {
  components: {
    Stack: {
      description: 'Layout container for related generated UI blocks.',
      props: z.object({
        align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
        direction: z.enum(['vertical', 'horizontal']).optional(),
        gap: z.enum(['none', 'xs', 'sm', 'md', 'lg']).optional(),
        tone: z.enum(['plain', 'muted', 'bordered']).optional(),
      }),
    },
    Text: {
      description: 'Short plain text label or paragraph.',
      props: z.object({
        text: z.string(),
        tone: z.enum(['default', 'muted', 'success', 'warning', 'danger']).optional(),
        weight: z.enum(['regular', 'medium', 'semibold']).optional(),
      }),
    },
    Markdown: {
      description: 'Markdown prose rendered with the same streaming renderer as chat messages.',
      props: z.object({ markdown: z.string() }),
    },
    Metric: {
      description: 'Compact metric with label, value, and optional detail.',
      props: z.object({
        detail: z.string().optional(),
        label: z.string(),
        value: z.string(),
      }),
    },
    Button: {
      description: 'A user action button. Emits press when clicked.',
      props: z.object({
        label: z.string(),
        tone: z.enum(['default', 'secondary', 'danger']).optional(),
      }),
    },
    Code: {
      description: 'Preformatted code or logs.',
      props: z.object({
        code: z.string(),
        language: z.string().optional(),
      }),
    },
    Table: {
      description: 'Small data table.',
      props: z.object({
        columns: z.array(z.string()).optional(),
        rows: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
    },
    KeyValueList: {
      description: 'Key-value rows for structured facts.',
      props: z.object({
        items: z.array(z.object({ label: z.string(), value: z.string() })),
      }),
    },
  },
  actions: {},
});

const { registry: generative_ui_registry } = defineRegistry(generative_ui_catalog, {
  components: {
    Stack: StackElement,
    Text: TextElement,
    Markdown: MarkdownElement,
    Metric: MetricElement,
    Button: ButtonElement,
    Code: CodeElement,
    Table: TableElement,
    KeyValueList: KeyValueListElement,
  },
});

export function GenerativeUiRenderer({
  isStreaming = false,
  rendererKey = 'json-render',
  uiSpec,
  uiSpecFormat = 'json-render',
}: GenerativeUiRendererProps) {
  const spec = json_render_spec_from_value(uiSpec);
  if (uiSpecFormat !== 'json-render' || rendererKey !== 'json-render') {
    return <GenerativeUiError message={`Unsupported generated UI renderer: ${rendererKey}`} />;
  }
  if (!spec) return <GenerativeUiError message="Generated UI spec is not a json-render spec." />;

  const validation = validateSpec(spec);
  if (!validation.valid) {
    return <GenerativeUiError message={validation.issues[0]?.message ?? 'Invalid UI spec.'} />;
  }

  return (
    <div className="w-full max-w-3xl rounded-2xl border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline">Generated UI</Badge>
        {isStreaming ? <span className="text-xs text-muted-foreground">Streaming...</span> : null}
      </div>
      <JSONUIProvider registry={generative_ui_registry}>
        <Renderer
          fallback={UnknownElement}
          loading={isStreaming}
          registry={generative_ui_registry}
          spec={spec}
        />
      </JSONUIProvider>
    </div>
  );
}

function StackElement({ children, props }: BaseComponentProps<StackProps>) {
  return (
    <div
      className={cn(
        'min-w-0',
        direction_class_names[props.direction ?? 'vertical'],
        gap_class_names[props.gap ?? 'sm'],
        align_class_names[props.align ?? 'stretch'],
        tone_class_names[props.tone ?? 'plain'],
      )}
    >
      {children}
    </div>
  );
}

function TextElement({ props }: BaseComponentProps<TextProps>) {
  return (
    <div
      className={cn(
        'text-sm leading-6',
        text_tone_class_names[props.tone ?? 'default'],
        text_weight_class_names[props.weight ?? 'regular'],
      )}
    >
      {props.text}
    </div>
  );
}

function MarkdownElement({ props }: BaseComponentProps<{ markdown: string }>) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <Markdown>{props.markdown}</Markdown>
    </div>
  );
}

function MetricElement({ props }: BaseComponentProps<MetricProps>) {
  return (
    <div className="min-w-32 rounded-2xl border border-border bg-sunken px-3 py-2">
      <div className="text-[11px] uppercase text-muted-foreground">{props.label}</div>
      <div className="mt-1 text-xl font-semibold">{props.value}</div>
      {props.detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{props.detail}</div>
      ) : null}
    </div>
  );
}

function ButtonElement({ emit, props }: BaseComponentProps<ButtonProps>) {
  return (
    <Button
      size="sm"
      type="button"
      variant={
        props.tone === 'danger' ? 'destructive' : props.tone === 'secondary' ? 'outline' : 'default'
      }
      onClick={() => emit('press')}
    >
      {props.label}
    </Button>
  );
}

function CodeElement({
  props,
}: BaseComponentProps<{ code: string; language?: string | undefined }>) {
  return (
    <pre className="overflow-auto rounded-2xl border border-border bg-sunken p-3 font-mono text-xs leading-5">
      <code>{props.code}</code>
    </pre>
  );
}

function TableElement({ props }: BaseComponentProps<TableProps>) {
  const rows = props.rows ?? [];
  const columns = props.columns ?? columns_from_rows(rows);
  if (rows.length === 0 || columns.length === 0) return null;

  return (
    <div className="overflow-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-sunken">
          <tr>
            {columns.map((column) => (
              <th className="border-r border-b border-border px-2 py-1.5 font-medium" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 80).map((row) => (
            <tr key={generated_table_row_key(row)}>
              {columns.map((column) => (
                <td className="border-r border-b border-border px-2 py-1.5" key={column}>
                  {stringify_cell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueListElement({ props }: BaseComponentProps<KeyValueListProps>) {
  return (
    <dl className="grid gap-1 text-sm">
      {props.items.map((item) => (
        <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2" key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UnknownElement({ element }: ComponentRenderProps) {
  return <GenerativeUiError message={`Unknown generated UI component: ${element.type}`} />;
}

function GenerativeUiError({ message }: { message: string }) {
  return (
    <div className="flex w-full max-w-3xl items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

type StackProps = {
  align?: 'start' | 'center' | 'end' | 'stretch' | undefined;
  direction?: 'vertical' | 'horizontal' | undefined;
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | undefined;
  tone?: 'plain' | 'muted' | 'bordered' | undefined;
};

type TextProps = {
  text: string;
  tone?: 'default' | 'muted' | 'success' | 'warning' | 'danger' | undefined;
  weight?: 'regular' | 'medium' | 'semibold' | undefined;
};

type MetricProps = {
  detail?: string | undefined;
  label: string;
  value: string;
};

type ButtonProps = {
  label: string;
  tone?: 'default' | 'secondary' | 'danger' | undefined;
};

type TableProps = {
  columns?: string[] | undefined;
  rows?: Array<Record<string, unknown>> | undefined;
};

type KeyValueListProps = {
  items: Array<{ label: string; value: string }>;
};

const direction_class_names: Record<NonNullable<StackProps['direction']>, string> = {
  horizontal: 'flex flex-wrap',
  vertical: 'grid',
};

const gap_class_names: Record<NonNullable<StackProps['gap']>, string> = {
  lg: 'gap-4',
  md: 'gap-3',
  none: 'gap-0',
  sm: 'gap-2',
  xs: 'gap-1',
};

const align_class_names: Record<NonNullable<StackProps['align']>, string> = {
  center: 'items-center',
  end: 'items-end',
  start: 'items-start',
  stretch: 'items-stretch',
};

const tone_class_names: Record<NonNullable<StackProps['tone']>, string> = {
  bordered: 'rounded-2xl border border-border p-3',
  muted: 'rounded-2xl bg-sunken p-3',
  plain: '',
};

const text_tone_class_names: Record<NonNullable<TextProps['tone']>, string> = {
  danger: 'text-destructive',
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  success: 'text-positive-ink',
  warning: 'text-caution-ink',
};

const text_weight_class_names: Record<NonNullable<TextProps['weight']>, string> = {
  medium: 'font-medium',
  regular: 'font-normal',
  semibold: 'font-semibold',
};

function columns_from_rows(rows: Array<Record<string, unknown>>) {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

function stringify_cell(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function generated_table_row_key(row: Record<string, unknown>) {
  return JSON.stringify(row);
}
