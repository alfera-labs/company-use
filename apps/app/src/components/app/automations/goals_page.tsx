import { public_brand_config } from '@coworker/config/public_env';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { new_chat_draft_key } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import { Markdown } from '@/components/prompt-kit/markdown';
import { list_workspace_files, open_workspace_file } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { new_chat_path } from '@/lib/website_task_request';

const product_brand_name = public_brand_config.product_brand_name;

const goals_folder = 'goals';

export type Goal = {
  slug: string;
  objective: string;
  status: string;
  body: string;
};

export function GoalsPage() {
  const navigate = useNavigate();
  const folder_query = useQuery({
    queryKey: query_keys.workspace_folder(goals_folder),
    queryFn: () => list_workspace_files(goals_folder),
    retry: false,
  });
  const file_paths = (folder_query.data?.files ?? [])
    .map((file) => file.file_name)
    .filter((file_name) => file_name.endsWith('.md'))
    .map((file_name) => `${goals_folder}/${file_name}`);
  const file_queries = useQueries({
    queries: file_paths.map((file_path) => ({
      queryKey: query_keys.workspace_file(file_path),
      queryFn: () => open_workspace_file(file_path),
      retry: false,
    })),
  });
  const goals = file_queries.flatMap((query, index) => {
    const file_path = file_paths[index];
    const text = query.data?.content_text;
    if (!file_path || !text) return [];
    const goal = read_goal(file_path, text);
    return goal ? [goal] : [];
  });

  const change_plan = (goal: Goal) => {
    useChatDraftStore
      .getState()
      .set_draft(
        new_chat_draft_key,
        `Change the plan for the goal "${goal.objective}" (goals/${goal.slug}.md): `,
      );
    void navigate({ href: new_chat_path });
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col pb-10">
      <Link
        className="mt-1 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        to="/automations"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Automations
      </Link>
      <h1 className="mt-6 text-xl font-semibold text-balance">Goals</h1>
      <p className="mt-2 text-sm text-muted-foreground text-pretty">
        What {product_brand_name} is working towards, and what has moved. Each goal is checked on
        its own schedule.
      </p>

      {folder_query.isLoading ? <Skeleton className="mt-8 h-40 w-full" /> : null}
      {!folder_query.isLoading && goals.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No goals yet. Ask in chat for something to be pursued over time.
        </p>
      ) : null}

      <GoalList goals={goals} onChangePlan={change_plan} />
    </main>
  );
}

export function GoalList({
  goals,
  onChangePlan,
}: {
  goals: Goal[];
  onChangePlan: (goal: Goal) => void;
}) {
  return (
    <ul className="mt-7 flex flex-col divide-y border-t">
      {goals.map((goal) => (
        <li className="flex flex-col gap-2 py-5" key={goal.slug}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-medium text-balance">{goal.objective}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{goal.status}</p>
            </div>
            <Button size="sm" type="button" variant="outline" onClick={() => onChangePlan(goal)}>
              Change plan
            </Button>
          </div>
          <Markdown>{goal.body}</Markdown>
        </li>
      ))}
    </ul>
  );
}

// A 12-line reader rather than a YAML dependency in the browser bundle. The writer is
// runtime-platform/goals/goal_file_format.ts and writes exactly these keys.
export function read_goal(file_path: string, file_text: string): Goal | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(file_text.trim());
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const objective = fields.get('objective');
  if (!objective) return null;
  return {
    slug: file_path.replace(/^goals\//, '').replace(/\.md$/, ''),
    objective,
    status: fields.get('status') ?? 'active',
    body: (match[2] ?? '').trim(),
  };
}
