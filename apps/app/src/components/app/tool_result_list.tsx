import { AppMark } from '@/components/app/app_mark';
import { read_link_host, type ToolResultItem } from '@/components/app/tool_result_items';

export function ToolResultList({
  items,
  iconUrl,
  toolName,
}: {
  items: readonly ToolResultItem[];
  iconUrl?: string | undefined;
  toolName: string;
}) {
  return (
    <ul className="grid gap-1.5">
      {items.map((item) => (
        <li className="flex min-w-0 items-start gap-2" key={`${item.title}:${item.url ?? ''}`}>
          <AppMark
            className="mt-[2px] size-[14px]"
            name={toolName}
            {...(iconUrl ? { iconUrl } : {})}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] text-foreground">{item.title}</span>
              {item.url ? (
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {read_link_host(item.url)}
                </span>
              ) : null}
            </span>
            {item.detail ? (
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                {item.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
