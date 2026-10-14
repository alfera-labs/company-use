import {
  has_frontmatter,
  read_body_under_frontmatter,
  read_frontmatter,
} from '@runtime-platform/notifications/frontmatter';
import { z } from 'zod';

export const goals_folder = 'goals';
export const goal_statuses = ['active', 'paused', 'done'] as const;
export const goal_reviews = ['daily', 'weekly'] as const;

type GoalStatus = (typeof goal_statuses)[number];
export type GoalReview = (typeof goal_reviews)[number];

const goal_frontmatter_schema = z.object({
  objective: z.string().min(1).max(500),
  status: z.enum(goal_statuses).default('active'),
  review: z.enum(goal_reviews).default('weekly'),
  automation_id: z.string().min(1).nullish(),
});

export type GoalFile = {
  slug: string;
  objective: string;
  status: GoalStatus;
  review: GoalReview;
  automation_id: string | null;
  constraints: string;
  plan: string;
  progress: string[];
};

/** Where one goal lives, workspace-relative. */
export function goal_file_path(slug: string) {
  return `${goals_folder}/${slug}.md`;
}

/** The last thing that happened, which is the only progress line a summary has room for. */
export function last_progress_line(goal: GoalFile): string | null {
  return goal.progress.at(-1) ?? null;
}

// A file without readable frontmatter is not a goal — it is some other Markdown somebody dropped
// in the folder. Returning null keeps it out of the list instead of inventing an objective for it.
// A goal whose frontmatter is a typo therefore disappears from the page rather than
// showing as broken; add a parse_failed surface when somebody actually hits it.
export function parse_goal_file(slug: string, file_text: string): GoalFile | null {
  if (!has_frontmatter(file_text)) return null;
  const parsed = goal_frontmatter_schema.safeParse(read_frontmatter(file_text));
  if (!parsed.success) return null;
  const sections = read_sections(read_body_under_frontmatter(file_text));
  return {
    slug,
    objective: parsed.data.objective,
    status: parsed.data.status,
    review: parsed.data.review,
    automation_id: parsed.data.automation_id ?? null,
    constraints: sections.get('constraints') ?? '',
    plan: sections.get('plan') ?? '',
    progress: (sections.get('progress') ?? '')
      .split('\n')
      .map((line) => line.replace(/^-\s*/u, '').trim())
      .filter(Boolean),
  };
}

export function render_goal_file(goal: GoalFile): string {
  return [
    '---',
    `objective: ${goal.objective}`,
    `status: ${goal.status}`,
    `review: ${goal.review}`,
    ...(goal.automation_id ? [`automation_id: ${goal.automation_id}`] : []),
    '---',
    '',
    '## Constraints',
    goal.constraints.trim() || 'None stated.',
    '',
    '## Plan',
    goal.plan.trim() || 'Not written yet.',
    '',
    '## Progress',
    ...goal.progress.map((line) => `- ${line}`),
    '',
  ].join('\n');
}

/** One dated line per step forward, appended by whoever advanced the goal. */
export function progress_line(what_happened: string, now: Date): string {
  return `${now.toISOString().slice(0, 10)}: ${what_happened.trim()}`;
}

function read_sections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let open_key: string | null = null;
  let open_lines: string[] = [];
  const close = () => {
    if (open_key) sections.set(open_key, open_lines.join('\n').trim());
  };
  for (const line of body.split(/\r?\n/u)) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading?.[1]) {
      close();
      open_key = heading[1].toLowerCase();
      open_lines = [];
      continue;
    }
    open_lines.push(line);
  }
  close();
  return sections;
}
