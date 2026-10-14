import { use_deploy_look } from '@coworker/ui/lib/company_use_deploy/deploy_look';
import type { ReactNode } from 'react';

export function DeployScreen({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  const look = use_deploy_look();
  return (
    <section className={look.screen} aria-live="polite">
      <h1 className={look.title}>{title}</h1>
      {lead ? <p className={look.lead}>{lead}</p> : null}
      {children}
    </section>
  );
}
