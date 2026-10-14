import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import {
  type ConnectionToolPolicyView,
  get_group_mode,
  get_tool_mode,
  type ToolPolicyView,
} from '@/components/connections/connection_tool_policy_state';
import {
  ToolGroupModeMenu,
  ToolModeControl,
} from '@/components/connections/tool_permission_controls';
import type { ToolPolicyMode } from '@/lib/api/types';

export function ToolPermissionGroup<T extends ConnectionToolPolicyView>({
  description = null,
  disabled,
  label,
  policies,
  tools,
  onSetGroup,
  onSetTool,
}: {
  description?: string | null;
  disabled: boolean;
  label: string;
  policies: ToolPolicyView[];
  tools: T[];
  onSetGroup: (mode: ToolPolicyMode) => void;
  onSetTool: (tool: T, mode: ToolPolicyMode) => void;
}) {
  const [is_open, set_is_open] = useState(true);
  const group_mode = get_group_mode(tools, policies);

  return (
    <section className="border-border border-b last:border-b-0">
      <div className="flex min-h-12 items-center gap-3">
        <button
          type="button"
          aria-expanded={is_open}
          onClick={() => set_is_open((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left text-sm font-medium"
        >
          <ChevronDown
            className={
              is_open ? 'size-4 text-muted-foreground' : '-rotate-90 size-4 text-muted-foreground'
            }
            aria-hidden="true"
          />
          <span className="truncate">{label}</span>
          <span className="rounded-xl bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {tools.length}
          </span>
        </button>
        <ToolGroupModeMenu disabled={disabled} value={group_mode} onChange={onSetGroup} />
      </div>
      {description ? (
        <p className="-mt-2 pb-3 pl-6 text-xs text-muted-foreground">{description}</p>
      ) : null}

      {is_open ? (
        <ul className="ml-6 divide-y divide-border border-border border-t">
          {tools.map((tool) => (
            <li
              key={tool.node_key}
              className="flex min-h-15 items-center justify-between gap-4 py-3"
            >
              <span className="min-w-0 truncate text-sm">{tool.node_display_name}</span>
              <ToolModeControl
                disabled={disabled}
                label={tool.node_display_name}
                value={get_tool_mode(tool, policies)}
                onChange={(mode) => onSetTool(tool, mode)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
