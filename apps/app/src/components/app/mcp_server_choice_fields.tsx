import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { cn } from '@coworker/ui/lib/utils';
import { X } from 'lucide-react';
import { Fragment } from 'react';
import type { McpRequestHeaderDraft } from '@/components/app/use_mcp_server_addition';

export function ChoiceRow<Value extends string>({
  name,
  value,
  selected,
  title,
  badge,
  description,
  children,
  on_select,
}: {
  name: string;
  value: Value;
  selected: Value;
  title: string;
  badge?: string | undefined;
  description: string;
  children?: React.ReactNode;
  on_select: (value: Value) => void;
}) {
  const id = `${name}-${value}`;
  const is_selected = selected === value;

  return (
    <div className="space-y-2">
      <div className="flex gap-2.5">
        <input
          checked={is_selected}
          className="mt-1 size-4 shrink-0 accent-primary"
          id={id}
          name={name}
          type="radio"
          value={value}
          onChange={() => on_select(value)}
        />
        <div className="space-y-0.5">
          <Label className="flex flex-wrap items-center gap-1.5 font-medium" htmlFor={id}>
            {title}
            {badge ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                {badge}
              </span>
            ) : null}
          </Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {is_selected && children ? <div className="ml-6.5 space-y-3">{children}</div> : null}
    </div>
  );
}

export function LabelledField({
  id,
  label,
  hint,
  value,
  placeholder,
  secret,
  refusal,
  on_change,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  value: string;
  placeholder?: string | undefined;
  secret?: boolean | undefined;
  refusal?: string | null | undefined;
  on_change: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={refusal ? true : undefined}
        {...(refusal ? { 'aria-describedby': `${id}-refusal` } : {})}
        {...(placeholder ? { placeholder } : {})}
        // Browsers ignore autocomplete="off" on password fields and offer to
        // save the value; new-password is the one they honour.
        {...(secret ? { type: 'password' as const, autoComplete: 'new-password' } : {})}
        value={value}
        onChange={(event) => on_change(event.target.value)}
      />
      {refusal ? (
        <p className="text-xs text-destructive" id={`${id}-refusal`} role="alert">
          {refusal}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function RequestHeaderRows({
  headers,
  maximum,
  on_change,
}: {
  headers: McpRequestHeaderDraft[];
  maximum: number;
  on_change: (headers: McpRequestHeaderDraft[]) => void;
}) {
  const replace_at = (index: number, header: Partial<McpRequestHeaderDraft>) =>
    on_change(headers.map((row, at) => (at === index ? { ...row, ...header } : row)));

  return (
    <div className="space-y-2">
      {headers.map((header, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the row's position is its identity here.
        <Fragment key={index}>
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Header ${index + 1} name`}
              className="flex-1"
              placeholder="Header name"
              value={header.name}
              onChange={(event) => replace_at(index, { name: event.target.value })}
            />
            <Input
              aria-label={`Header ${index + 1} value`}
              autoComplete="new-password"
              className="flex-1"
              placeholder="Value"
              type="password"
              value={header.value}
              onChange={(event) => replace_at(index, { value: event.target.value })}
            />
            <button
              aria-label={`Remove header ${index + 1}`}
              className={cn(
                'rounded p-1 text-muted-foreground hover:text-foreground',
                headers.length === 1 ? 'invisible' : '',
              )}
              type="button"
              onClick={() => on_change(headers.filter((_, at) => at !== index))}
            >
              <X className="size-4" />
            </button>
          </div>
        </Fragment>
      ))}
      {headers.length < maximum ? (
        <button
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          type="button"
          onClick={() => on_change([...headers, { name: '', value: '' }])}
        >
          + Add header
        </button>
      ) : null}
    </div>
  );
}
