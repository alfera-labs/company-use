// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
'use client';

import { read_cloud_from_the_address } from '@coworker/ui/lib/company_use_deploy/cloud_from_the_address';
import type {
  DeployChoices,
  DeploySession,
  TestOverrides,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';
import {
  act_on_problem_action,
  begin_deploy,
  type DeployConfig,
  read_aws_link,
  type Screen,
  type SetScreen,
  wait_after_aws_opened,
} from '@coworker/ui/lib/company_use_deploy/deploy_steps';
import type { ProblemAction } from '@coworker/ui/lib/company_use_deploy/deploy_words';
import {
  choices_of,
  show_the_deploy_this_browser_remembers,
} from '@coworker/ui/lib/company_use_deploy/remembered_deploy';
import { take_test_overrides_from_the_address } from '@coworker/ui/lib/company_use_deploy/test_overrides';
import { useCallback, useEffect, useRef, useState } from 'react';

const default_choices: DeployChoices = { cloud: 'digitalocean', name: '', backups: false };

function show_the_first_screen(
  config: DeployConfig,
  set_screen: SetScreen,
  set_choices: (choices: DeployChoices) => void,
): TestOverrides | null {
  const test_overrides = take_test_overrides_from_the_address(config.allows_test_overrides);
  const cloud_in_the_address = read_cloud_from_the_address(window.location.search);
  const set_choices_with_the_address_cloud = (picked: DeployChoices) =>
    set_choices({ ...picked, cloud: cloud_in_the_address ?? picked.cloud });
  set_choices_with_the_address_cloud(default_choices);
  void show_the_deploy_this_browser_remembers(
    set_screen,
    set_choices_with_the_address_cloud,
    config.digitalocean_client_id,
  );
  return test_overrides;
}

export function use_deploy_flow(config: DeployConfig) {
  const [screen, set_screen] = useState<Screen>({ name: 'loading' });
  const [choices, set_choices] = useState<DeployChoices>(default_choices);
  const test_overrides = useRef<TestOverrides | null>(null);
  const has_started = useRef(false);

  useEffect(() => {
    if (has_started.current) return;
    has_started.current = true;
    test_overrides.current = show_the_first_screen(config, set_screen, set_choices);
  }, [config]);

  const begin = useCallback(
    (picked: DeployChoices, replaces_install_id: string | null = null) =>
      begin_deploy(picked, replaces_install_id, {
        config,
        test_overrides: test_overrides.current,
        set_screen,
      }),
    [config],
  );

  const aws_link = useCallback(
    (session: DeploySession) => read_aws_link(session, config.aws_template_url ?? ''),
    [config],
  );

  const aws_opened = (session: DeploySession) => wait_after_aws_opened(session, set_screen);

  const act_on_problem = useCallback(
    (action: ProblemAction, session: DeploySession | null) =>
      act_on_problem_action(action, session, {
        client_id: config.digitalocean_client_id,
        begin: (replaces_install_id) =>
          begin(session ? choices_of(session) : choices, replaces_install_id),
        set_screen,
      }),
    [begin, choices, config],
  );

  return { screen, set_screen, choices, begin, aws_link, aws_opened, act_on_problem };
}
