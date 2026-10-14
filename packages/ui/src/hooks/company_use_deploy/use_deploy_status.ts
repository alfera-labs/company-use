// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
'use client';

import { deploy_api_address } from '@coworker/ui/lib/company_use_deploy/deploy_api';
import {
  type ProgressReport,
  status_answer_schema,
} from '@coworker/ui/lib/company_use_deploy/deploy_schemas';
import { useEffect, useState } from 'react';

const milliseconds_between_looks = 4000;

export type DeployStatus = {
  reports: ProgressReport[];
  is_unknown: boolean;
  site_clock_ahead_by: number;
};

const empty_status: DeployStatus = { reports: [], is_unknown: false, site_clock_ahead_by: 0 };

async function look_at_the_status(
  api_origin: string,
  install_id: string,
): Promise<DeployStatus | null> {
  const path = `status?${new URLSearchParams({ install_id })}`;
  const asked_at = Date.now();
  const answer = await fetch(deploy_api_address(api_origin, path), { cache: 'no-store' });
  if (answer.status === 404) return { ...empty_status, is_unknown: true };
  if (!answer.ok) return null;
  const { data } = status_answer_schema.parse(await answer.json());
  const answered_at = (asked_at + Date.now()) / 2;
  return {
    reports: data.reports,
    is_unknown: false,
    site_clock_ahead_by: data.site_time - answered_at,
  };
}

export function use_deploy_status(api_origin: string, install_id: string) {
  const [status, set_status] = useState<DeployStatus>(empty_status);
  useEffect(() => {
    let is_current = true;
    const look = () =>
      look_at_the_status(api_origin, install_id)
        .then((next) => {
          if (is_current && next) set_status(next);
        })
        .catch((error: unknown) =>
          console.warn('[company-use-deploy] the status did not load', error),
        );
    look();
    const timer = setInterval(look, milliseconds_between_looks);
    return () => {
      is_current = false;
      clearInterval(timer);
    };
  }, [api_origin, install_id]);
  return status;
}

export function use_clock(milliseconds = 1000) {
  const [now, set_now] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => set_now(Date.now()), milliseconds);
    return () => clearInterval(timer);
  }, [milliseconds]);
  return now;
}
