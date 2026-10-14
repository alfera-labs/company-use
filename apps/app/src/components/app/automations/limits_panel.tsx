import { Input } from '@coworker/ui/components/input';
import { useState } from 'react';
import {
  default_budget,
  type EditorBudget,
  type EditorValue,
} from '@/components/app/automations/automation_editor_model';
import { EditorSection } from '@/components/app/automations/automation_editor_panels';

export function LimitsPanel({
  value,
  onChange,
}: {
  value: EditorValue;
  onChange: (value: EditorValue) => void;
}) {
  const set_budget = (budget: EditorBudget) => onChange({ ...value, budget });

  return (
    <EditorSection title="Limits">
      <LimitRow
        label="Max runs per day"
        value={value.budget.max_fires_per_day}
        fallback={default_budget.max_fires_per_day}
        min={1}
        max={500}
        onCommit={(max_fires_per_day) => set_budget({ ...value.budget, max_fires_per_day })}
      />
      <LimitRow
        label="Max empty runs in a row"
        value={value.budget.max_no_progress_runs}
        fallback={default_budget.max_no_progress_runs}
        min={1}
        max={100}
        onCommit={(max_no_progress_runs) => set_budget({ ...value.budget, max_no_progress_runs })}
      />
    </EditorSection>
  );
}

function LimitRow({
  label,
  sub,
  value,
  fallback,
  min,
  max,
  onCommit,
}: {
  label: string;
  sub?: string;
  value: number;
  fallback: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [typed, set_typed] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{label}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      <Input
        aria-label={label}
        className="h-8 w-20 rounded-xl"
        type="number"
        min={min}
        max={max}
        value={typed ?? String(value)}
        onChange={(event) => set_typed(event.target.value)}
        onBlur={() => {
          onCommit(read_limit(typed, { fallback, min, max }));
          set_typed(null);
        }}
      />
    </div>
  );
}

function read_limit(
  text: string | null,
  bounds: { fallback: number; min: number; max: number },
): number {
  if (text === null || text.trim() === '') return bounds.fallback;
  const parsed = Math.round(Number(text));
  if (!Number.isFinite(parsed)) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
