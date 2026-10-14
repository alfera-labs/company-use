import type { Database } from '@coworker/core';
import {
  type AutomationWeekReview,
  list_automation_review_stats,
} from '@coworker/core/db/queries/automation_review_stats';
import { list_open_loops, type OpenLoop } from '@coworker/core/db/queries/open_loops';
import {
  list_recent_deliverables,
  type RecentDeliverable,
} from '@coworker/core/db/queries/recent_deliverables';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  list_watching_notes,
  type WatchingNote,
} from '@runtime-platform/automations/watching_files';
import { last_progress_line } from '@runtime-platform/goals/goal_file_format';
import { list_goal_files } from '@runtime-platform/goals/goal_files';
import type { ScoutCalendarEvent } from '@runtime-platform/scout/scout_calendar';
import {
  build_signal_clusters,
  type Embedder,
  type ScoutMemoryHit,
  search_memory_for_clusters,
} from '@runtime-platform/scout/scout_memory_clusters';

const log = create_logger('scout_context');
const section_caps = {
  signals: 80,
  open_loops: 25,
  deliverables: 15,
  goals: 10,
  watching: 10,
  memory_hits_per_cluster: 3,
  memory_clusters: 3,
} as const;

import { list_recent_signals, type ScoutSignal } from '@runtime-platform/scout/scout_signals';

export type { ScoutMemoryHit } from '@runtime-platform/scout/scout_memory_clusters';
export { list_recent_signals, type ScoutSignal };

type ScoutGoalLine = { slug: string; objective: string; last_progress: string | null };

export type ScoutContext = {
  recent_signals: ScoutSignal[];
  open_loops: OpenLoop[];
  memory_hits: ScoutMemoryHit[];
  recent_deliverables: RecentDeliverable[];
  upcoming_events: ScoutCalendarEvent[];
  goals: ScoutGoalLine[];
  watching: WatchingNote[];
  automation_review: AutomationWeekReview[];
};

export async function collect_scout_context(
  db: Database,
  input: {
    workspace_id: string;
    agent_id?: string | undefined;
    now?: Date | undefined;
    signal_limit?: number | undefined;
    open_loop_limit?: number | undefined;
    memory_limit?: number | undefined;
    embedder?: Embedder | undefined;
    review_automations?: boolean | undefined;
  },
): Promise<ScoutContext> {
  const now = input.now ?? new Date();
  const [recent_signals, open_loops, recent_deliverables, automation_review, files] =
    await Promise.all([
      list_recent_signals(db, {
        workspace_id: input.workspace_id,
        now,
        limit: input.signal_limit ?? section_caps.signals,
      }),
      list_open_loops(db, {
        workspace_id: input.workspace_id,
        now,
        limit: input.open_loop_limit ?? section_caps.open_loops,
      }),
      list_recent_deliverables(db, {
        workspace_id: input.workspace_id,
        now,
        limit: section_caps.deliverables,
      }),
      input.review_automations
        ? list_automation_review_stats(db, { workspace_id: input.workspace_id, now })
        : [],
      read_goals_and_watching(db, input.workspace_id, input.agent_id),
    ]);
  const memory_hits = await search_memory_for_clusters(db, {
    workspace_id: input.workspace_id,
    clusters: build_signal_clusters({
      signals: recent_signals,
      open_loop_titles: open_loops.map((loop) => loop.title),
    }),
    limit_per_cluster: input.memory_limit ?? section_caps.memory_hits_per_cluster,
    max_clusters: section_caps.memory_clusters,
    ...(input.embedder ? { embedder: input.embedder } : {}),
  });
  const context: ScoutContext = {
    recent_signals,
    open_loops,
    memory_hits,
    recent_deliverables,
    upcoming_events: [],
    goals: files.goals,
    watching: files.watching,
    automation_review,
  };
  log_packet_size(input.workspace_id, context);
  return context;
}

async function read_goals_and_watching(db: Database, workspace_id: string, agent_id?: string) {
  if (!agent_id) return { goals: [], watching: [] };
  const [goal_files, watching] = await Promise.all([
    list_goal_files(db, { workspace_id, agent_id }),
    list_watching_notes(db, { workspace_id, agent_id }),
  ]).catch((error: unknown) => {
    log.warn('goals and watching notes were not readable this pulse', {
      workspace_id,
      error: format_error_message(error),
    });
    return [[], []] as const;
  });
  return {
    goals: goal_files.slice(0, section_caps.goals).map((goal) => ({
      slug: goal.slug,
      objective: goal.objective,
      last_progress: last_progress_line(goal),
    })),
    watching: watching.slice(0, section_caps.watching),
  };
}

function estimate_packet_tokens(context: ScoutContext) {
  return Math.ceil(JSON.stringify(context).length / 4);
}

function log_packet_size(workspace_id: string, context: ScoutContext) {
  log.info('scout packet built', {
    workspace_id,
    estimated_tokens: estimate_packet_tokens(context),
    signals: context.recent_signals.length,
    open_loops: context.open_loops.length,
    deliverables: context.recent_deliverables.length,
    memory_hits: context.memory_hits.length,
    upcoming_events: context.upcoming_events.length,
  });
}
