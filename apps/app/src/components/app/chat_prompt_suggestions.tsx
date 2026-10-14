import { Button } from '@coworker/ui/components/button';
import { cn } from '@coworker/ui/lib/utils';
import {
  Handshake,
  LifeBuoy,
  type LucideIcon,
  Megaphone,
  ReceiptText,
  Rocket,
  Workflow,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type ButtonHTMLAttributes,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { suggestions_that_start_on_an_app_event } from '@/components/app/chat_prompt_suggestions_for_app_events';
import type { CatalogApp } from '@/lib/api';
import { app_logo_domains_by_key } from '@/lib/app_logo_domains';
import { app_logo_url } from '@/lib/app_logo_url';
import {
  app_alias_keys,
  app_icon_url,
  app_key,
  app_matches_alias,
  normalize_app_key,
} from '@/lib/catalog_app';

const transition_suggestions = {
  duration: 0.18,
  ease: 'easeOut' as const,
};

const suggestions_that_run_on_a_schedule: PromptSuggestionGroup[] = [
  {
    label: 'Sales',
    highlight: 'reply',
    prompt: 'Run my sales follow-through',
    appAliases: ['HubSpot', 'Gmail', 'Apollo', 'Slack'],
    icon: Handshake,
    items: [
      {
        title: 'CRM that matches your inbox',
        outcome: 'Every reply logged, every stage current, by 6pm daily',
        text: 'Every weekday at 6pm, read my sent mail and replies, match each thread to its HubSpot deal, log the touch, move any stage that changed, and flag deals where the last reply is mine and five or more days old.',
        appAliases: ['Gmail', 'HubSpot'],
      },
      {
        title: 'Revive stale deals with receipts',
        outcome: 'Quiet deals get a draft that quotes their own last words',
        text: 'Each Monday, find deals with no touch in 14 days, and for each one draft a reply in the existing thread that quotes the last thing the prospect said, proposes one next step, and puts a date on it. Leave every draft for my review.',
        appAliases: ['HubSpot', 'Gmail'],
      },
      {
        title: 'Brief before every call',
        outcome: 'One page on the company and the person, 30 minutes ahead',
        text: 'Thirty minutes before each external meeting on my calendar, send me one page: who they are, what their company does, our last three touches from the CRM, and one recent trigger — funding, hiring, launch — worth opening with.',
        appAliases: ['Google Calendar', 'HubSpot', 'Gmail'],
      },
      {
        title: 'Outbound list built and cleaned',
        outcome: '200 ICP accounts enriched, deduped against your CRM',
        text: 'Build a list of 200 accounts matching our ICP from Apollo, enrich contacts in Clay, remove anything already in HubSpot, normalize company names, and prepare an Instantly sequence with a one-line personalization per account.',
        appAliases: ['Apollo', 'Clay', 'HubSpot', 'Instantly'],
      },
    ],
  },
  {
    label: 'Marketing',
    highlight: 'flag',
    prompt: 'Watch my ad performance',
    appAliases: ['Google Ads', 'Meta Ads', 'Google Analytics', 'Notion'],
    icon: Megaphone,
    items: [
      {
        title: 'Creative fatigue, caught early',
        outcome: 'CTR decay flagged per ad before CPA rises, 3 fresh angles each',
        text: 'Twice a week, check every active ad in Google Ads and Meta Ads for click-through decay against its own first two weeks. Flag ads that are tiring, and draft three replacement angles for each — hook, body, CTA — in Notion.',
        appAliases: ['Google Ads', 'Meta Ads', 'Notion'],
      },
      {
        title: 'Spend to pipeline, weekly',
        outcome: 'Every dollar mapped to pipeline, the 3 decisions written out',
        text: 'Every Friday, map last week’s ad spend to the pipeline it created: spend by campaign, leads, qualified leads, and pipeline value from HubSpot. End with the three decisions the numbers point to, and post it to Slack.',
        appAliases: ['Google Ads', 'Meta Ads', 'HubSpot', 'Slack'],
      },
      {
        title: 'Search waste sweep',
        outcome: 'Wasted spend cut monthly, negatives proposed, savings priced',
        text: 'Monthly, pull the search terms report, find terms spending with no conversions, propose negative keywords grouped by theme, and estimate the monthly saving in a Google Sheet. Apply nothing without my sign-off.',
        appAliases: ['Google Ads', 'Google Sheets'],
      },
      {
        title: 'Landing pages vs keywords',
        outcome: 'The pages dragging Quality Score, with the fix per page',
        text: 'Audit each ad landing page against the keywords and search terms that point at it. Score the alignment, list the pages hurting Quality Score, and write the specific content fix for each page — heading, section, proof.',
        appAliases: ['Google Ads', 'Google Analytics', 'Notion'],
      },
      {
        title: 'Competitor moves, Fridays',
        outcome: 'Their ads, pricing and launches tracked so you never are surprised',
        text: 'Watch our three main competitors: new ads in the ad libraries, pricing page changes, product launches, and notable hires. Summarize what changed and what it implies for us, every Friday at 3pm in Slack.',
        appAliases: ['Slack', 'Notion'],
      },
    ],
  },
  {
    label: 'Finance',
    highlight: 'reconcile',
    prompt: 'Run my finance ops',
    appAliases: ['Stripe', 'QuickBooks', 'Google Sheets', 'Gmail'],
    icon: ReceiptText,
    items: [
      {
        title: 'Overdue invoices, chased politely',
        outcome: 'A 14/30-day cadence that skips disputes and logs every reply',
        text: 'Every Monday at 9am, list invoices past due, group by lateness, and send the chase that matches: gentle at 14 days, firmer at 30. Skip anyone on the do-not-chase list or in an open dispute, and log every reply against the invoice.',
        appAliases: ['QuickBooks', 'Gmail', 'Slack'],
      },
      {
        title: 'Close the month in 3 days',
        outcome: 'Stripe and QuickBooks reconciled, exceptions listed, not hunted',
        text: 'On the 1st, run the close: reconcile Stripe payouts against QuickBooks, verify balances, chase the missing receipts from their owners, and hand me one list of exceptions with the likely cause attached to each.',
        appAliases: ['Stripe', 'QuickBooks', 'Slack'],
      },
      {
        title: 'Failed payments, same day',
        outcome: 'Each failure gets a tailored recovery email before it churns',
        text: 'Check Stripe for failed payments every morning. For each, draft a recovery email that names the plan and the amount, propose the retry, update the tracker, and summarize recovered vs at-risk revenue in Slack on Fridays.',
        appAliases: ['Stripe', 'Gmail', 'Google Sheets', 'Slack'],
      },
      {
        title: 'Runway that updates itself',
        outcome: 'Burn recomputed from live data, a ping when a threshold breaks',
        text: 'Keep the runway model current: pull live Stripe revenue and sheet expenses weekly, recompute burn and months of runway, and message me the moment projected runway crosses 12, 9, or 6 months.',
        appAliases: ['Stripe', 'Google Sheets', 'Slack'],
      },
      {
        title: 'Software spend audit',
        outcome: 'Unused subscriptions found, cancellation drafts ready to send',
        text: 'Quarterly, list recurring software charges from receipts and card statements, match each tool to whether anyone still uses it, find duplicates, and draft the cancellation or downgrade email for everything that fails the test.',
        appAliases: ['Google Drive', 'Gmail', 'Google Sheets'],
      },
    ],
  },
  {
    label: 'Support',
    highlight: 'escalate',
    prompt: 'Run my support queue',
    appAliases: ['Slack', 'Gmail', 'Linear', 'Notion'],
    icon: LifeBuoy,
    items: [
      {
        title: 'Queue triaged before 9am',
        outcome: 'Tickets tagged and ranked, the urgent ones escalated with context',
        text: 'Every weekday at 8am, read the new support tickets, tag each by topic and severity, escalate anything urgent to Slack with a two-line context summary, and leave the queue ordered by what actually needs a human first.',
        appAliases: ['Gmail', 'Slack', 'Linear'],
      },
      {
        title: 'Weekly digest with teeth',
        outcome: 'Top issues ranked by count and account size, tickets opened',
        text: 'Every Friday, roll the week’s tickets into ranked themes weighted by how many customers and how much revenue each touches. Open a scoped Linear issue for the top three, and post the digest to the team channel.',
        appAliases: ['Linear', 'Slack', 'Gmail'],
      },
      {
        title: 'Follow up after the fix',
        outcome: 'Every resolved ticket gets a check-in three days later',
        text: 'Three days after a ticket is resolved, draft a short check-in: did the fix hold, is anything else in the way. Send after my approval, and log accounts that come back unhappy so we see repeat pain early.',
        appAliases: ['Gmail', 'Slack'],
      },
    ],
  },
  {
    label: 'Operations',
    highlight: 'chase',
    prompt: 'Run my ops loops',
    appAliases: ['Slack', 'Notion', 'Linear', 'Google Sheets'],
    icon: Workflow,
    items: [
      {
        title: 'Chase the updates nobody sent',
        outcome: 'Owners nudged until the sheet is complete — before the meeting',
        text: 'Every Monday at 8am, check which weekly updates are missing from the sheet, nudge each owner in Slack by name with exactly what is missing, keep nudging non-responders at noon, and post the completed summary before the 3pm meeting.',
        appAliases: ['Google Sheets', 'Slack', 'Notion'],
      },
      {
        title: 'Renewals surfaced 60 days out',
        outcome: 'No contract lapses quietly — outreach drafted, task per renewal',
        text: 'Track contract renewal dates in the sheet. Sixty days before each, draft the check-in email, open a Linear task with the owner, and post a monthly view of everything renewing in the next quarter.',
        appAliases: ['Google Sheets', 'Gmail', 'Linear'],
      },
    ],
  },
  {
    label: 'Founders',
    highlight: 'draft',
    prompt: 'Run my founder ops',
    appAliases: ['Stripe', 'HubSpot', 'Notion', 'Slack'],
    icon: Rocket,
    items: [
      {
        title: 'Revenue pulse before coffee',
        outcome: 'MRR, churn, CAC and anomalies in Slack every morning at 7:30',
        text: 'Every morning at 7:30, pull MRR, new revenue, churn, CAC and pipeline from Stripe, HubSpot and the model sheet. Post one Slack message: the numbers, the deltas, and anything anomalous called out in a sentence.',
        appAliases: ['Stripe', 'HubSpot', 'Google Sheets', 'Slack'],
      },
      {
        title: 'Investor update, 90% written',
        outcome: 'Metrics pulled, narrative drafted, asks included — you edit',
        text: 'Draft the monthly investor update: revenue and burn from Stripe and the sheet, pipeline from HubSpot, product progress from Linear, plus the asks. Match the tone of the last three updates and leave it in Notion for my edit.',
        appAliases: ['Stripe', 'HubSpot', 'Notion', 'Gmail'],
      },
      {
        title: 'Board deck, first draft',
        outcome: 'Growth, product, GTM, financials — every number sourced',
        text: 'Draft this quarter’s board deck from the metrics sheet and Notion updates: growth, product, go-to-market, financials, and the key asks. Cite the source next to every number so I can defend each slide.',
        appAliases: ['Google Sheets', 'Notion', 'Slack'],
      },
      {
        title: 'Cash position, Fridays 4pm',
        outcome: 'Cash in, cash out, runway — one message, never a surprise',
        text: 'Every Friday at 4pm, send the cash position: balance, what came in, what went out, burn versus plan, and months of runway. Flag any single expense over our threshold with who approved it.',
        appAliases: ['Stripe', 'QuickBooks', 'Slack'],
      },
      {
        title: 'Inbox sorted by 8am',
        outcome: 'Replies drafted, noise archived, only decisions left for you',
        text: 'Every morning before 8am, triage my inbox: draft replies to anything that needs one, archive newsletters and notifications, and leave me a short list of only the messages that need a decision from me.',
        appAliases: ['Gmail', 'Slack'],
      },
    ],
  },
];

export const prompt_suggestions: PromptSuggestionGroup[] = suggestions_that_run_on_a_schedule.map(
  with_app_event_suggestions,
);

function with_app_event_suggestions(group: PromptSuggestionGroup): PromptSuggestionGroup {
  const items = [...group.items];
  for (const placed of suggestions_that_start_on_an_app_event[group.label] ?? []) {
    items.splice(placed.position, 0, placed.item);
  }
  return { ...group, items };
}

export type PromptSuggestionGroup = {
  label: string;
  highlight: string;
  prompt: string;
  items: PromptSuggestionItem[];
  icon: LucideIcon;
  appAliases: string[];
};

export type PromptSuggestionItem = {
  title: string;
  outcome: string;
  text: string;
  appAliases: string[];
};

type PromptSuggestionProps = {
  appAliases?: string[];
  apps?: CatalogApp[];
  children: ReactNode;
  className?: string;
  highlight?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const ChatPromptSystem = memo(function ChatPromptSystem({
  apps = [],
  extraGroups = [],
  onSuggestion,
  onValueChange,
  value,
}: {
  apps?: CatalogApp[];
  extraGroups?: PromptSuggestionGroup[];
  onSuggestion: (suggestion: string) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="relative order-1 w-full md:absolute md:bottom-[-84px] md:order-2 md:h-[84px]">
      <AnimatePresence mode="popLayout">
        <ChatPromptSuggestions
          apps={apps}
          extraGroups={extraGroups}
          value={value}
          onSuggestion={onSuggestion}
          onValueChange={onValueChange}
        />
      </AnimatePresence>
    </div>
  );
});

const MotionPromptSuggestion = motion.create(PromptSuggestion);

const ChatPromptSuggestions = memo(function ChatPromptSuggestions({
  apps,
  extraGroups,
  onSuggestion,
  onValueChange,
  value,
}: {
  apps: CatalogApp[];
  extraGroups: PromptSuggestionGroup[];
  onSuggestion: (suggestion: string) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const [active_category, set_active_category] = useState<string | null>(null);
  const groups = useMemo(
    () => (extraGroups.length > 0 ? [...extraGroups, ...prompt_suggestions] : prompt_suggestions),
    [extraGroups],
  );
  const active_category_key = value ? active_category : null;
  const active_category_data = groups.find((group) => group.label === active_category_key);
  const show_category_suggestions = Boolean(
    active_category_data && active_category_data.items.length > 0,
  );

  const choose_suggestion = useCallback(
    (suggestion: string) => {
      set_active_category(null);
      onSuggestion(suggestion);
      onValueChange('');
    },
    [onSuggestion, onValueChange],
  );

  const choose_category = useCallback(
    (suggestion: PromptSuggestionGroup) => {
      set_active_category(suggestion.label);
      onValueChange(suggestion.prompt);
    },
    [onValueChange],
  );

  const suggestions_grid = useMemo(
    () => (
      <div
        key="suggestions-grid"
        className="flex w-full max-w-full flex-nowrap justify-start gap-2 overflow-x-auto px-2 md:mx-auto md:max-w-3xl md:flex-wrap md:justify-center md:pl-0"
        style={{ scrollbarWidth: 'none' }}
      >
        {groups.map((suggestion) => (
          <PromptSuggestion
            appAliases={suggestion.appAliases}
            apps={apps}
            key={suggestion.label}
            type="button"
            onClick={() => choose_category(suggestion)}
          >
            <suggestion.icon className="size-4" />
            <span>{suggestion.label}</span>
          </PromptSuggestion>
        ))}
      </div>
    ),
    [apps, choose_category, groups],
  );

  const suggestions_list = useMemo(
    () => (
      <motion.div
        key={active_category_data?.label}
        className="flex w-full flex-col space-y-1 px-2"
        initial="initial"
        animate="animate"
        variants={{
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -8 },
        }}
        transition={transition_suggestions}
      >
        {active_category_data?.items.map((suggestion, index) => (
          <MotionPromptSuggestion
            appAliases={suggestion.appAliases}
            apps={apps}
            key={`${active_category_data.label}-${suggestion.text}`}
            highlight={active_category_data.highlight}
            type="button"
            className="block h-auto text-left"
            initial="initial"
            animate="animate"
            variants={{
              initial: { opacity: 0, y: -8 },
              animate: { opacity: 1, y: 0 },
            }}
            transition={{
              ...transition_suggestions,
              delay: index * 0.03,
            }}
            onClick={() => choose_suggestion(suggestion.text)}
          >
            {suggestion.text}
          </MotionPromptSuggestion>
        ))}
      </motion.div>
    ),
    [active_category_data, apps, choose_suggestion],
  );

  return (
    <AnimatePresence mode="wait">
      {show_category_suggestions ? suggestions_list : suggestions_grid}
    </AnimatePresence>
  );
});

function PromptSuggestion({
  appAliases,
  apps = [],
  children,
  className,
  highlight,
  ...props
}: PromptSuggestionProps) {
  const is_highlight_mode = highlight !== undefined && highlight.trim() !== '';
  const content = typeof children === 'string' ? children : '';

  if (!is_highlight_mode) {
    return (
      <Button
        variant="outline"
        size="lg"
        className={cn('h-10 rounded-full px-3', className)}
        {...props}
      >
        <SuggestionAppStack aliases={appAliases ?? []} apps={apps} />
        {children}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-auto min-h-11 w-full justify-start gap-3 rounded-3xl px-3 py-2 hover:bg-accent',
        className,
      )}
      {...props}
    >
      <SuggestionAppStack aliases={appAliases ?? []} apps={apps} />
      <HighlightedSuggestionText content={content} highlight={highlight.trim()} />
    </Button>
  );
}

export function SuggestionAppStack({
  aliases,
  apps,
  presentation = 'stack',
}: {
  aliases: string[];
  apps: CatalogApp[];
  presentation?: 'stack' | 'row';
}) {
  const marks = build_app_marks(aliases, apps);
  if (marks.length === 0) return null;

  if (presentation === 'row') {
    return (
      <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
        {marks.map((mark) => (
          <span
            className="grid size-[22px] place-items-center overflow-hidden rounded-[6px] bg-card p-[3px] text-[10px] font-medium text-muted-foreground ring-1 ring-border"
            key={mark.key}
            title={mark.name}
          >
            {mark.icon_url ? (
              <span
                className="size-full bg-contain bg-center bg-no-repeat"
                style={{ backgroundImage: `url("${mark.icon_url}")` }}
              />
            ) : (
              mark.name.slice(0, 1).toUpperCase()
            )}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="flex shrink-0 -space-x-1" aria-hidden="true">
      {marks.map((mark) => (
        <span
          className="grid size-5 place-items-center overflow-hidden rounded-full border border-background bg-muted text-[10px] font-medium text-muted-foreground shadow-xs"
          key={mark.key}
          title={mark.name}
        >
          {mark.icon_url ? (
            <span
              className="size-full bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url("${mark.icon_url}")` }}
            />
          ) : (
            mark.name.slice(0, 1).toUpperCase()
          )}
        </span>
      ))}
    </span>
  );
}

function HighlightedSuggestionText({ content, highlight }: { content: string; highlight: string }) {
  const content_lower = content.toLowerCase();
  const highlight_lower = highlight.toLowerCase();
  const index = content_lower.indexOf(highlight_lower);

  if (index === -1) {
    return <span className="whitespace-normal text-pretty text-muted-foreground">{content}</span>;
  }

  const highlighted_text = content.substring(index, index + highlight.length);
  const before = content.substring(0, index);
  const after = content.substring(index + highlighted_text.length);

  return (
    <span className="whitespace-normal text-pretty">
      {before ? <span className="text-muted-foreground">{before}</span> : null}
      <span className="font-medium text-brand-ink">{highlighted_text}</span>
      {after ? <span className="text-muted-foreground">{after}</span> : null}
    </span>
  );
}

function build_app_marks(aliases: string[], apps: CatalogApp[]) {
  const marks: Array<{ icon_url?: string; key: string; name: string }> = [];
  const seen_keys = new Set<string>();

  for (const alias of aliases) {
    const app = find_app_by_alias(apps, alias);
    const key = app ? app_key(app) : `fallback:${normalize_app_key(alias)}`;
    const icon_url = app ? (app_icon_url(app) ?? alias_icon_url(alias)) : alias_icon_url(alias);
    if (seen_keys.has(key)) continue;
    seen_keys.add(key);
    marks.push({
      key,
      name: app?.app_display_name ?? alias,
      ...(icon_url ? { icon_url } : {}),
    });
    if (marks.length === 4) break;
  }

  return marks;
}

function find_app_by_alias(apps: CatalogApp[], alias: string) {
  return apps.find((app) => app_matches_alias(app, alias));
}

function alias_icon_url(alias: string) {
  const domain = app_alias_keys(alias)
    .map((key) => app_logo_domains_by_key[key])
    .find(Boolean);
  return app_logo_url(domain);
}
