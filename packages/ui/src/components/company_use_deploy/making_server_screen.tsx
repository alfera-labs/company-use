'use client';

import { DeployScreen } from '@coworker/ui/components/company_use_deploy/deploy_screen';
import { OpenAwsLink } from '@coworker/ui/components/company_use_deploy/open_aws_link';
import {
  use_clock,
  use_deploy_status,
} from '@coworker/ui/hooks/company_use_deploy/use_deploy_status';
import { use_deploy_look } from '@coworker/ui/lib/company_use_deploy/deploy_look';
import {
  type DeploySession,
  keep_the_secrets_after_the_first_report,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';
import { making_words, open_aws_words } from '@coworker/ui/lib/company_use_deploy/deploy_words';
import {
  build_progress_rows,
  type ProgressOutcome,
  type ProgressRow,
  read_outcome,
} from '@coworker/ui/lib/company_use_deploy/progress_rows';
import { cn } from '@coworker/ui/lib/utils';
import { useEffect, useRef } from 'react';

const minutes_before_the_first_report: Record<DeploySession['cloud'], number> = {
  digitalocean: 20,
  aws: 60,
};

const state_words: Record<ProgressRow['state'], string> = {
  waiting: 'Not started',
  live: 'Working',
  done: 'Done',
};

export function format_elapsed(seconds: number | null) {
  if (seconds === null) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ProgressRows({ rows }: { rows: ProgressRow[] }) {
  const look = use_deploy_look();
  return (
    <ol className={look.rows}>
      {rows.map((row) => (
        <li key={row.key} className={cn(look.row, look.row_by_state[row.state])}>
          <span className={look.mark_by_state[row.state]} aria-hidden="true" />
          <span className={look.row_title}>{row.title}</span>
          <span className={look.visually_hidden}>{state_words[row.state]}</span>
          <span className={look.row_time}>{format_elapsed(row.seconds)}</span>
        </li>
      ))}
    </ol>
  );
}

export function MakingServerScreen({
  session,
  aws_link_again,
  on_outcome,
}: {
  session: DeploySession;
  aws_link_again: string | null;
  on_outcome: (
    outcome: Exclude<ProgressOutcome, { kind: 'working' }> | { kind: 'unknown' },
  ) => void;
}) {
  const status = use_deploy_status(session.api_origin, session.install_id);
  const now = use_clock() + status.site_clock_ahead_by;
  const started_at = session.started_at + status.site_clock_ahead_by;
  const first_report_minutes = minutes_before_the_first_report[session.cloud];
  const outcome = read_outcome(status.reports, started_at, now, first_report_minutes);
  const rows = build_progress_rows(status.reports, started_at, now);
  const outcome_kind = status.is_unknown ? 'unknown' : outcome.kind;

  const reported_kind = useRef('working');
  const has_a_report = status.reports.length > 0;

  useEffect(() => {
    if (has_a_report) keep_the_secrets_after_the_first_report(session.install_id);
  }, [has_a_report, session.install_id]);

  useEffect(() => {
    if (outcome_kind === reported_kind.current) return;
    reported_kind.current = outcome_kind;
    if (status.is_unknown) on_outcome({ kind: 'unknown' });
    else if (outcome.kind !== 'working') on_outcome(outcome);
  });

  return (
    <DeployScreen
      title={making_words.title}
      lead={outcome.kind === 'done' ? making_words.opening : making_words.lead}
    >
      <ProgressRows rows={rows} />
      {aws_link_again && status.reports.length === 0 ? (
        <OpenAwsLink href={aws_link_again} label={open_aws_words.again} kind="again" />
      ) : null}
    </DeployScreen>
  );
}
