import { RadioGroup, RadioGroupItem } from '@coworker/ui/components/radio-group';
import { cn } from '@coworker/ui/lib/utils';
import type { NotificationRules } from '@/components/app/automations/automations_api';
import type { ChangeRules } from '@/components/app/automations/use_notification_rules_draft';

const dial_choices: { dial: NotificationRules['dial']; label: string; description: string }[] = [
  { dial: 'off', label: 'Summary only', description: 'One message a day' },
  {
    dial: 'quiet',
    label: 'Deadlines only',
    description: 'Plus anything that would be gone by tomorrow.',
  },
  { dial: 'normal', label: 'When it matters', description: 'The default.' },
  { dial: 'eager', label: 'Everything', description: 'As it happens.' },
];

export function NotifyMeField({
  policy,
  change,
}: {
  policy: NotificationRules;
  change: ChangeRules;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">Notify me</legend>
      <RadioGroup
        className="mt-3 grid-cols-2 gap-2.5"
        value={policy.dial}
        onValueChange={(value) => change_dial(change, value)}
      >
        {dial_choices.map((choice) => (
          <DialCard key={choice.dial} choice={choice} selected={choice.dial === policy.dial}>
            {dial_description(choice, policy)}
          </DialCard>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

function change_dial(change: ChangeRules, value: unknown) {
  const chosen = dial_choices.find((choice) => choice.dial === value);
  if (chosen) change({ dial: chosen.dial });
}

function DialCard({
  choice,
  selected,
  children,
}: {
  choice: (typeof dial_choices)[number];
  selected: boolean;
  children: string;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2.5 rounded-2xl border p-3 text-sm',
        selected ? 'border-brand' : 'border-input',
      )}
      htmlFor={`attention-${choice.dial}`}
    >
      <RadioGroupItem className="mt-0.5" id={`attention-${choice.dial}`} value={choice.dial} />
      <span className="flex flex-col items-start gap-0.5">
        <span>{choice.label}</span>
        <span className="text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

function dial_description(choice: (typeof dial_choices)[number], policy: NotificationRules) {
  if (choice.dial === 'off') return `${choice.description} at ${policy.daily_summary_at_time}.`;
  if (choice.dial === 'normal') {
    return `${choice.description} Up to ${policy.max_notifications_per_day} a day.`;
  }
  return choice.description;
}
