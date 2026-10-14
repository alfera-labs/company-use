import { cn } from '@coworker/ui/lib/utils';

export type TextRun = {
  text: string;
  is_match: boolean;
};

export function read_text_runs_string(runs: readonly TextRun[]) {
  return runs.map((run) => run.text).join('');
}

export function MatchText({ runs, className }: { runs: readonly TextRun[]; className?: string }) {
  return (
    <span className={cn(className)}>
      {locate_runs(runs).map(({ run, character_offset }) =>
        run.is_match ? (
          <mark
            key={character_offset}
            className="rounded-[3px] bg-primary/15 px-0.5 font-medium text-foreground"
          >
            {run.text}
          </mark>
        ) : (
          <span key={character_offset}>{run.text}</span>
        ),
      )}
    </span>
  );
}

function locate_runs(runs: readonly TextRun[]) {
  let character_offset = 0;
  return runs.map((run) => {
    const located_run = { run, character_offset };
    character_offset += run.text.length;
    return located_run;
  });
}
