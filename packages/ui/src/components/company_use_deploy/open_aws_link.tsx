import { use_deploy_look } from '@coworker/ui/lib/company_use_deploy/deploy_look';

const look_slot_by_kind = { main: 'main_button', again: 'second_button' } as const;

export function OpenAwsLink(props: {
  href: string;
  label: string;
  kind: keyof typeof look_slot_by_kind;
  on_open?: () => void;
}) {
  const look = use_deploy_look();
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener"
      className={look[look_slot_by_kind[props.kind]]}
      onClick={props.on_open}
    >
      {props.label}
    </a>
  );
}
