import { public_brand_config } from '@coworker/config/public_env';
import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import {
  list_notifications,
  type Notification,
} from '@/components/app/automations/automations_api';
import { AutomationsLayout } from '@/components/app/automations/automations_layout';
import { use_idea_actions } from '@/components/app/automations/use_idea_actions';
import { Markdown } from '@/components/prompt-kit/markdown';
import { open_workspace_file_if_present } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';

const product_brand_name = public_brand_config.product_brand_name;

const ideas_file_path = 'ideas.md';

export function IdeasPage() {
  const ideas_file_query = useQuery({
    queryKey: query_keys.workspace_file(ideas_file_path),
    queryFn: () => open_workspace_file_if_present(ideas_file_path),
    retry: false,
  });
  const parked_query = useQuery({
    queryKey: query_keys.notifications('ideas'),
    queryFn: () =>
      list_notifications({ outcome: ['add_to_ideas_list'], only_open: true, page_size: 50 }),
  });
  const parked = parked_query.data?.items ?? [];
  return (
    <AutomationsLayout>
      <Link
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        to="/automations"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Automations
      </Link>
      <h2 className="mt-4 text-xl font-semibold text-balance">Ideas</h2>
      <p className="mt-2 text-sm text-muted-foreground text-pretty">
        Things {product_brand_name} thought of and left alone. Set one up and it becomes an
        automation.
      </p>
      <ParkedIdeas parked={parked} />
      <IdeasFile
        error={ideas_file_query.error}
        isLoading={ideas_file_query.isLoading}
        text={ideas_file_query.data?.content_text ?? null}
        hasParkedIdeas={parked.length > 0}
      />
    </AutomationsLayout>
  );
}

function ParkedIdeas({ parked }: { parked: Notification[] }) {
  const { dismiss, set_it_up } = use_idea_actions();
  return (
    <ul className="mt-7 divide-y border-t">
      {parked.map((idea) => (
        <li className="flex items-start gap-4 py-3.5" key={idea.event_id}>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{idea.notification.title}</div>
            <p className="mt-1 text-muted-foreground">{idea.notification.body}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <OfferButton idea={idea} onSayYes={() => set_it_up(idea)} />
            <Button
              disabled={dismiss.isPending && dismiss.variables === idea.event_id}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => dismiss.mutate(idea.event_id)}
            >
              Dismiss
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// The connect link lands on the integrations page, not on that app's card — the page
// keeps its search in component state, so there is no URL to deep-link to yet.
export function offer_label(proposed: Notification['notification']['proposed_action']): string {
  if (proposed?.kind === 'connect_app') return `Connect ${proposed.app_name}`;
  if (proposed?.kind === 'improve_automation') return 'Change it';
  return proposed?.kind === 'offer_to_act' ? 'Yes, do it' : 'Set it up';
}

export function OfferButton({ idea, onSayYes }: { idea: Notification; onSayYes: () => void }) {
  const proposed = idea.notification.proposed_action;
  if (proposed?.kind === 'connect_app') {
    return (
      <Button render={<Link to="/integrations" />} size="sm" variant="outline">
        {offer_label(proposed)}
      </Button>
    );
  }
  return (
    <Button size="sm" type="button" variant="outline" onClick={onSayYes}>
      {offer_label(proposed)}
    </Button>
  );
}

export function IdeasFile({
  error,
  isLoading,
  text,
  hasParkedIdeas,
}: {
  error: unknown;
  isLoading: boolean;
  text: string | null;
  hasParkedIdeas: boolean;
}) {
  if (isLoading) return <Skeleton className="mt-8 h-40 w-full" />;
  if (error && !is_nothing_written_yet(error)) {
    return (
      <p className="mt-8 text-sm">
        {format_error_message(error, 'The ideas file could not be read.')}
      </p>
    );
  }
  if (!text?.trim()) {
    return hasParkedIdeas ? null : (
      <p className="mt-8 text-sm text-muted-foreground">No ideas yet.</p>
    );
  }
  return (
    <section className="mt-10">
      <Markdown>{text}</Markdown>
    </section>
  );
}

function is_nothing_written_yet(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}
