import { cn } from '@coworker/ui/lib/utils';
import { activity_detail_class_name } from '@/components/app/chat_activity_row';

const max_tree_depth = 8;
const inline_text_limit = 200;

export function ToolDetailTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth >= max_tree_depth) return <ToolDetailBlock text={stringify_value(value)} />;
  if (Array.isArray(value)) return <ToolDetailList items={value} depth={depth} />;
  if (is_plain_object(value)) return <ToolDetailFields record={value} depth={depth} />;
  return <ToolDetailLeaf value={value} />;
}

function ToolDetailFields({ record, depth }: { record: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(record);
  if (entries.length === 0) return <EmptyMark word="empty" />;

  return (
    <div className="grid min-w-0 gap-1">
      {entries.map(([key, item]) => (
        <ToolDetailField field={key} key={key} value={item} depth={depth} />
      ))}
    </div>
  );
}

function ToolDetailField({
  depth,
  field,
  value,
}: {
  depth: number;
  field: string;
  value: unknown;
}) {
  const branch = read_branch_value(value);

  if (branch === null) {
    return (
      <div className="flex min-w-0 gap-1.5">
        <span className={cn('shrink-0', activity_detail_class_name)}>{field}</span>
        <ToolDetailLeaf value={value} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className={cn('mb-0.5', activity_detail_class_name)}>
        {field}
        {branch.was_json_text ? <span className="ml-1.5 opacity-70">json</span> : null}
      </div>
      <NestedRail>
        <ToolDetailTree depth={depth + 1} value={branch.value} />
      </NestedRail>
    </div>
  );
}

function ToolDetailList({ items, depth }: { items: unknown[]; depth: number }) {
  if (items.length === 0) return <EmptyMark word="empty" />;

  return (
    <div className="grid min-w-0 gap-1.5">
      {items.map((item, index) => (
        <div className="flex min-w-0 gap-2" key={item_key(item, index)}>
          <span className={cn('w-4 shrink-0 text-right tabular-nums', activity_detail_class_name)}>
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <ToolDetailTree depth={depth + 1} value={item} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolDetailLeaf({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <EmptyMark word="none" />;

  const text = leaf_text(value);
  if (text === '') return <EmptyMark word="empty" />;
  if (is_block_text(text)) return <ToolDetailBlock text={text} />;
  return <span className="min-w-0 break-words">{text}</span>;
}

function ToolDetailBlock({ text }: { text: string }) {
  return (
    <NestedRail>
      <pre className="whitespace-pre-wrap break-words">{text}</pre>
    </NestedRail>
  );
}

function NestedRail({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 border-border/50 border-l pl-2.5">{children}</div>;
}

function EmptyMark({ word }: { word: string }) {
  return <span className={cn('italic', activity_detail_class_name)}>{word}</span>;
}

function read_branch_value(value: unknown): { value: unknown; was_json_text: boolean } | null {
  if (Array.isArray(value) || is_plain_object(value)) {
    return { value, was_json_text: false };
  }

  const parsed = read_json_text(value);
  return parsed === null ? null : { value: parsed, was_json_text: true };
}

function read_json_text(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) || is_plain_object(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function leaf_text(value: unknown) {
  return typeof value === 'string' ? value : String(value);
}

function is_block_text(text: string) {
  return text.includes('\n') || text.length > inline_text_limit;
}

function item_key(item: unknown, index: number) {
  const record = is_plain_object(item) ? item : null;
  const id = record?.id ?? record?.node_key ?? record?.name;
  return typeof id === 'string' && id ? `${index}:${id}` : String(index);
}

export function stringify_value(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
