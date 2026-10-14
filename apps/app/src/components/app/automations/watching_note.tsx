import { Button } from '@coworker/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type AutomationFire,
  list_automation_fires,
} from '@/components/app/automations/automations_api';
import {
  describe_hold_reason,
  summary_words,
} from '@/components/app/automations/fire_outcome_words';
import { Markdown } from '@/components/prompt-kit/markdown';
import { open_workspace_file_if_present } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function watching_file_path(automation_name: string) {
  const slug =
    automation_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  return `watching/${slug}.md`;
}

/** The prose under the frontmatter, and only when the frontmatter says it is a wait (`subject:`,
 * the key the run instruction dictates). A run that wrote a log there instead of a wait is not
 * shown as "waiting on" anything. The frontmatter itself is bookkeeping nobody reads. */
export function watching_note_body(file_text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(file_text.trim());
  if (!match || !/^subject:\s*\S/m.test(match[1] ?? '')) return '';
  return (match[2] ?? '').trim();
}

export function WatchingNote({
  automationId,
  automationName,
  summaryTime,
}: {
  automationId: string;
  automationName: string;
  summaryTime: string | undefined;
}) {
  const file_path = watching_file_path(automationName);
  const note_query = useQuery({
    queryKey: query_keys.workspace_file(file_path),
    queryFn: () => open_workspace_file_if_present(file_path),
    retry: false,
  });
  const fires_query = useQuery({
    queryKey: query_keys.automation_fires(automationId),
    queryFn: () => list_automation_fires(automationId, { page: 1, page_size: 20 }),
    refetchInterval: 15_000,
  });
  const unanswered = find_unanswered_question(fires_query.data?.items ?? []);

  const body = note_query.data?.content_text
    ? watching_note_body(note_query.data.content_text)
    : '';
  if (!body && !unanswered) return null;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">What it is waiting on</h2>
      {body ? (
        <div className="mt-2 text-sm text-muted-foreground">
          <Markdown>{body}</Markdown>
        </div>
      ) : null}
      {unanswered ? <UnansweredQuestion fire={unanswered} summaryTime={summaryTime} /> : null}
    </section>
  );
}

export function find_unanswered_question(fires: AutomationFire[]): AutomationFire | null {
  return fires.find((fire) => fire.told?.asks_the_person && fire.told.open) ?? null;
}

function UnansweredQuestion({
  fire,
  summaryTime,
}: {
  fire: AutomationFire;
  summaryTime: string | undefined;
}) {
  const told = fire.told;
  if (!told) return null;
  const held = told.outcome === 'add_to_daily_summary';
  return (
    <div className="mt-3 rounded-2xl border bg-raised p-4 text-sm shadow-raised">
      <p className="font-medium">{told.title}</p>
      {held ? (
        <p className="mt-1 text-muted-foreground">
          Not sent yet — {describe_hold_reason(told)}. It is in {summary_words(summaryTime)}.
        </p>
      ) : null}
      {fire.session_id ? (
        <Button
          className="mt-3"
          render={<Link params={{ session_id: fire.session_id }} to="/chats/{-$session_id}" />}
          size="sm"
          variant="outline"
        >
          Answer in chat
        </Button>
      ) : null}
    </div>
  );
}
