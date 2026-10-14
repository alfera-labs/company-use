import { Button, buttonVariants } from '@coworker/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { cn } from '@coworker/ui/lib/utils';
import { Ban, Check, ChevronDown, CircleCheck, Hand } from 'lucide-react';
import {
  type ToolGroupMode,
  type ToolPreset,
  tool_presets,
} from '@/components/connections/connection_tool_policy_state';
import type { ToolPolicyMode } from '@/lib/api/types';

const mode_options = [
  { value: 'allow', label: 'Always allow', icon: CircleCheck },
  { value: 'ask', label: 'Ask each time', icon: Hand },
  { value: 'never', label: 'Never allow', icon: Ban },
] as const satisfies ReadonlyArray<{
  value: ToolPolicyMode;
  label: string;
  icon: typeof CircleCheck;
}>;

export function ToolPresetMenu({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: ToolPreset;
  onChange: (preset: Exclude<ToolPreset, 'custom'>) => void;
}) {
  const selected = tool_presets.find((preset) => preset.value === value) ?? tool_presets[4];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {selected.label}
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-80 p-1.5">
        {tool_presets.map((preset) => (
          <DropdownMenuItem
            key={preset.value}
            disabled={preset.value === 'custom'}
            className="items-start gap-3 py-2.5"
            onClick={() => preset.value !== 'custom' && onChange(preset.value)}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">{preset.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{preset.detail}</span>
            </span>
            {preset.value === value ? (
              <Check className="mt-0.5 size-4 text-brand-ink" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ToolGroupModeMenu({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: ToolGroupMode;
  onChange: (mode: ToolPolicyMode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="flex h-7 items-center gap-1 rounded-xl bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            {mode_label(value)}
            <ChevronDown className="size-3" aria-hidden="true" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {mode_options.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            <option.icon className="size-4" aria-hidden="true" />
            <span className="flex-1">{option.label}</span>
            {option.value === value ? <Check className="size-4 text-brand-ink" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ToolModeControl({
  disabled,
  label,
  value,
  onChange,
}: {
  disabled: boolean;
  label: string;
  value: ToolPolicyMode;
  onChange: (mode: ToolPolicyMode) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-xl bg-muted p-0.5">
      {mode_options.map((option) => {
        const Icon = option.icon;
        return (
          <Button
            key={option.value}
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={disabled}
            aria-label={`${option.label} for ${label}`}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              'size-7 rounded-[10px] text-muted-foreground hover:bg-hover hover:text-foreground',
              option.value === value && 'bg-raised text-foreground shadow-sm hover:bg-raised',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}

function mode_label(mode: ToolGroupMode) {
  if (mode === 'custom') return 'Custom';
  return mode_options.find((option) => option.value === mode)?.label ?? 'Custom';
}
