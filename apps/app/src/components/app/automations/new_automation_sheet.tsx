import { public_brand_config } from '@coworker/config/public_env';
import { Button } from '@coworker/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@coworker/ui/components/dialog';
import { cn } from '@coworker/ui/lib/utils';
import { Link } from '@tanstack/react-router';
import { LayoutTemplate, SlidersHorizontal, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const product_brand_name = public_brand_config.product_brand_name;

// The sentence travels as the query param the composer already reads (/home?prompt=).
const new_automation_prompt = 'Help me set up a new automation';

export function NewAutomationSheet() {
  const [open, set_open] = useState(false);
  const close = () => set_open(false);
  return (
    <Dialog open={open} onOpenChange={set_open}>
      <DialogTrigger render={<Button size="sm">New automation</Button>} />
      <DialogContent aria-label="New automation" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>How do you want to start?</DialogTitle>
          <DialogDescription>You can change everything later.</DialogDescription>
        </DialogHeader>
        <div className="mt-3 flex flex-col gap-2">
          <WayIn
            lead
            icon={<Sparkles aria-hidden="true" className="size-5" />}
            title="Describe it in chat"
            sub={`Say what should happen. ${product_brand_name} sets it up with you.`}
            to="/home"
            search={{ prompt: new_automation_prompt }}
            onPick={close}
          />
          <WayIn
            icon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
            title="Build it yourself"
            sub="Pick what starts it, write the instructions."
            to="/automations/new"
            onPick={close}
          />
          <WayIn
            icon={<LayoutTemplate aria-hidden="true" className="size-4" />}
            title="Start from a template"
            sub="Begin from one that already works."
            to="/templates"
            onPick={close}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WayIn({
  icon,
  title,
  sub,
  to,
  search,
  lead = false,
  onPick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  to: '/home' | '/automations/new' | '/templates';
  search?: { prompt: string };
  lead?: boolean;
  onPick: () => void;
}) {
  return (
    <Link
      className={cn(
        'flex items-center gap-3 rounded-2xl border px-3 py-3 text-left hover:bg-hover',
        lead && 'border-brand/40 py-4',
      )}
      data-lead={lead || undefined}
      to={to}
      {...(search ? { search } : {})}
      onClick={onPick}
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-xl bg-brand-wash text-brand-ink',
          lead ? 'size-11' : 'size-9',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </Link>
  );
}
