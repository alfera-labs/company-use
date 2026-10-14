// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import type { RowState } from '@coworker/ui/lib/company_use_deploy/progress_rows';
import { createContext, useContext } from 'react';

export type DeployLook = {
  screen: string;
  title: string;
  lead: string;
  form: string;
  clouds: string;
  cloud: string;
  cloud_picked: string;
  cloud_unavailable: string;
  cloud_text: string;
  cloud_name: string;
  cloud_note: string;
  chip: string;
  field: string;
  label: string;
  optional: string;
  input: string;
  hint: string;
  hint_wrong: string;
  address: string;
  check: string;
  main_button: string;
  second_button: string;
  privacy: string;
  rows: string;
  row: string;
  row_by_state: Record<RowState, string>;
  mark_by_state: Record<RowState, string>;
  row_title: string;
  row_time: string;
  visually_hidden: string;
};

export const DeployLookContext = createContext<DeployLook | null>(null);

export function use_deploy_look(): DeployLook {
  const look = useContext(DeployLookContext);
  if (!look) throw new Error('The deploy screens need a DeployLookContext provider.');
  return look;
}
