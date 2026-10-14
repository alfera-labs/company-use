'use client';

import { ChooseCloudScreen } from '@coworker/ui/components/company_use_deploy/choose_cloud_screen';
import { DeployScreen } from '@coworker/ui/components/company_use_deploy/deploy_screen';
import {
  MakingServerScreen,
  ProgressRows,
} from '@coworker/ui/components/company_use_deploy/making_server_screen';
import { OpenAwsLink } from '@coworker/ui/components/company_use_deploy/open_aws_link';
import { use_deploy_flow } from '@coworker/ui/hooks/company_use_deploy/use_deploy_flow';
import {
  type DeployLook,
  DeployLookContext,
  use_deploy_look,
} from '@coworker/ui/lib/company_use_deploy/deploy_look';
import {
  describe_problem,
  type PageProblemReason,
} from '@coworker/ui/lib/company_use_deploy/deploy_problems';
import type { DeploySession } from '@coworker/ui/lib/company_use_deploy/deploy_session';
import {
  type DeployConfig,
  open_the_new_server,
  type Screen,
} from '@coworker/ui/lib/company_use_deploy/deploy_steps';
import {
  action_words,
  leaving_words,
  making_words,
  open_aws_words,
  opened_words,
  problem_title,
} from '@coworker/ui/lib/company_use_deploy/deploy_words';
import {
  build_progress_rows,
  type ProgressOutcome,
} from '@coworker/ui/lib/company_use_deploy/progress_rows';
import type { ReactNode } from 'react';

type FinishedOutcome = Exclude<ProgressOutcome, { kind: 'working' }> | { kind: 'unknown' };
type Flow = ReturnType<typeof use_deploy_flow>;
type ScreenOf<Name extends Screen['name']> = Extract<Screen, { name: Name }>;

const problem_reason_by_outcome: Record<
  Exclude<FinishedOutcome['kind'], 'done'>,
  PageProblemReason
> = {
  failed: 'install_failed',
  silent: 'no_report',
  unknown: 'install_unknown',
};

function screen_after(outcome: FinishedOutcome, session: DeploySession): Screen | null {
  if (outcome.kind === 'done') {
    open_the_new_server(session, outcome.address);
    return null;
  }
  const box_reason = outcome.kind === 'failed' ? outcome.box_reason : null;
  const reason = problem_reason_by_outcome[outcome.kind];
  return {
    name: 'problem',
    problem: describe_problem(reason, session.cloud, { box_reason }),
    session,
  };
}

function ScreenWithButton(props: {
  title: string;
  lead: string;
  label: string;
  on_press: () => void;
}) {
  const look = use_deploy_look();
  return (
    <DeployScreen title={props.title} lead={props.lead}>
      <button type="button" className={look.main_button} onClick={props.on_press}>
        {props.label}
      </button>
    </DeployScreen>
  );
}

function render_choose(flow: Flow, config: DeployConfig) {
  const available = {
    digitalocean: Boolean(config.digitalocean_client_id && config.version),
    aws: Boolean(config.aws_template_url && config.version),
  };
  return <ChooseCloudScreen initial={flow.choices} available={available} on_start={flow.begin} />;
}

function aws_link_again_of(flow: Flow, session: DeploySession) {
  if (session.cloud !== 'aws') return null;
  const link = flow.aws_link(session);
  return 'href' in link ? link.href : null;
}

function render_making(flow: Flow, screen: ScreenOf<'making'>) {
  const on_outcome = (outcome: FinishedOutcome) => {
    const next = screen_after(outcome, screen.session);
    if (next) flow.set_screen(next);
  };
  return (
    <MakingServerScreen
      session={screen.session}
      aws_link_again={aws_link_again_of(flow, screen.session)}
      on_outcome={on_outcome}
    />
  );
}

function render_open_aws(flow: Flow, screen: ScreenOf<'open_aws'>, config: DeployConfig) {
  const link = flow.aws_link(screen.session);
  if ('problem' in link) return render_screen(flow, link.problem, config);
  return (
    <DeployScreen title={open_aws_words.title} lead={open_aws_words.lead}>
      <OpenAwsLink
        href={link.href}
        label={open_aws_words.button}
        kind="main"
        on_open={() => flow.aws_opened(screen.session)}
      />
    </DeployScreen>
  );
}

function render_creating() {
  return (
    <DeployScreen title={making_words.title} lead={making_words.lead}>
      <ProgressRows rows={build_progress_rows([], Date.now(), Date.now())} />
    </DeployScreen>
  );
}

const render_by_screen: {
  [Name in Screen['name']]: (flow: Flow, screen: ScreenOf<Name>, config: DeployConfig) => ReactNode;
} = {
  loading: () => <DeployScreen title={making_words.title} />,
  choose: (flow, _screen, config) => render_choose(flow, config),
  leaving: () => <DeployScreen title={leaving_words.title} lead={leaving_words.lead} />,
  creating: render_creating,
  open_aws: render_open_aws,
  making: render_making,
  opened: (_flow, screen) => (
    <ScreenWithButton
      title={opened_words.title}
      lead={opened_words.lead}
      label={opened_words.button}
      on_press={() => open_the_new_server(screen.session, screen.session.server_address ?? '')}
    />
  ),
  problem: (flow, screen) => (
    <ScreenWithButton
      title={problem_title}
      lead={screen.problem.sentence}
      label={action_words[screen.problem.action]}
      on_press={() => flow.act_on_problem(screen.problem.action, screen.session)}
    />
  ),
};

function render_screen<Name extends Screen['name']>(
  flow: Flow,
  screen: ScreenOf<Name>,
  config: DeployConfig,
) {
  const render = render_by_screen[screen.name] as (
    flow: Flow,
    screen: ScreenOf<Name>,
    config: DeployConfig,
  ) => ReactNode;
  return render(flow, screen, config);
}

function DeployScreens({ config }: { config: DeployConfig }) {
  const flow = use_deploy_flow(config);
  return render_screen(flow, flow.screen, config);
}

export function DeployFlow({ config, look }: { config: DeployConfig; look: DeployLook }) {
  return (
    <DeployLookContext value={look}>
      <DeployScreens config={config} />
    </DeployLookContext>
  );
}
