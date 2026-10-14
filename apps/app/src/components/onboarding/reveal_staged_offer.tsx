import { Clock, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { OfferAppsLine } from '@/components/onboarding/offer_apps_line';
import type { CompanyScanFinding } from '@/lib/api';

const loop_seconds = 8.5;
const seconds_between_steps = 1.3;
const loop = { duration: loop_seconds, repeat: Infinity, delay: 0.9, ease: 'easeOut' } as const;
const resting_opacity = 0.6;
const lights_at = (index: number) => (0.4 + index * seconds_between_steps) / loop_seconds;

/**
 * One job in full: the offer, the apps it runs in, and its steps lighting up in order, on a loop.
 * The whole job is one named part of a swap, so it fades out as one and the next one fades in
 * after it: no line of one job is ever drawn over a line of the other.
 */
export function StagedOffer({
  finding,
  index,
  reduceMotion,
}: {
  finding: CompanyScanFinding;
  index: number;
  reduceMotion: boolean;
}) {
  const steps = finding.steps ?? [];
  const tools = finding.tools ?? [];
  return (
    <section className="ob-run" style={{ viewTransitionName: `ob-run-${index}` }}>
      <div className="ob-run__head">
        <p className="ob-run__say">{finding.offer ?? say_with_schedule(finding.body)}</p>
        <OfferApps tools={tools} />
      </div>
      {steps.length ? (
        <ol className="ob-run__line" key={`${index}-${reduceMotion}`}>
          {steps.map((step, step_index) => (
            <RunStep
              index={step_index}
              isLast={step_index === steps.length - 1}
              key={step}
              reduceMotion={reduceMotion}
              step={step}
            />
          ))}
        </ol>
      ) : null}
      <OfferAppsLine finding={finding} />
    </section>
  );
}

export function OfferApps({ tools }: { tools: CompanyScanFinding['tools'] }) {
  if (!tools?.length) return null;
  return (
    <span className="ob-apps">
      {tools.map((tool) => (
        <span className="ob-plate" key={tool.logo_url} title={tool.name}>
          <AppLogo name={tool.name} url={tool.logo_url} />
        </span>
      ))}
    </span>
  );
}

const logos_already_shown = new Set<string>();

function AppLogo({ name, url }: { name: string; url: string }) {
  const [is_shown, set_is_shown] = useState(logos_already_shown.has(url));
  const show = () => {
    logos_already_shown.add(url);
    set_is_shown(true);
  };
  const show_if_it_loaded_before_the_page_went_live = (image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) show();
  };
  return (
    <img
      alt={name}
      data-shown={is_shown}
      onLoad={show}
      ref={show_if_it_loaded_before_the_page_went_live}
      src={url}
    />
  );
}

function RunStep({
  step,
  index,
  isLast,
  reduceMotion,
}: {
  step: string;
  index: number;
  isLast: boolean;
  reduceMotion: boolean;
}) {
  const at = lights_at(index);
  const lights_up = reduceMotion
    ? {}
    : {
        initial: { opacity: resting_opacity },
        animate: { opacity: [resting_opacity, resting_opacity, 1, 1, resting_opacity] },
        transition: { ...loop, times: [0, at, at + 0.03, 0.93, 1] },
      };
  return (
    <li className="ob-run__step">
      <motion.span className="ob-run__node" {...lights_up}>
        <StepMark step={step} />
        {reduceMotion ? null : <Ripple at={at} />}
      </motion.span>
      <motion.span {...lights_up}>{say_with_schedule(step)}</motion.span>
      {isLast || reduceMotion ? null : <RailLight arrives={lights_at(index + 1)} leaves={at} />}
    </li>
  );
}

function Ripple({ at }: { at: number }) {
  return (
    <motion.span
      animate={{
        opacity: [0, 0, 0.7, 0, 0],
        transform: ['scale(0.8)', 'scale(0.8)', 'scale(1)', 'scale(1.6)', 'scale(1.6)'],
      }}
      className="ob-run__ripple"
      initial={{ opacity: 0 }}
      transition={{ ...loop, times: [0, at, at + 0.01, at + 0.09, 1] }}
    />
  );
}

function RailLight({ leaves, arrives }: { leaves: number; arrives: number }) {
  return (
    <motion.span
      animate={{
        transform: ['scaleY(0)', 'scaleY(0)', 'scaleY(1)', 'scaleY(1)', 'scaleY(1)'],
        opacity: [1, 1, 1, 0, 0],
      }}
      className="ob-run__light"
      initial={{ transform: 'scaleY(0)' }}
      transition={{ ...loop, times: [0, leaves, arrives, arrives + 0.05, 1] }}
    />
  );
}

const fires_on_an_event = /^(?:the moment|when|whenever|as soon as|after every)\b/iu;

function StepMark({ step }: { step: string }) {
  if (fires_on_an_event.test(step))
    return <Zap aria-hidden="true" className="ob-run__icon ob-run__trigger" />;
  if (schedule_phrase.test(step)) return <Clock aria-hidden="true" className="ob-run__icon" />;
  return <i />;
}

const schedule_phrase =
  /\bthe moment\s[^,.;]+|\b(?:every|each)\s+(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|week(?:day)?|morning|month|day)(?:s)?(?:\s+(?:at|by)\s+[\w:.]+(?:\s?[ap]m)?)?|\btoday\b|\btomorrow\b/iu;

function say_with_schedule(body: string) {
  const match = schedule_phrase.exec(body);
  if (!match || match.index === undefined) return body;
  const start = match.index;
  const end = start + match[0].length;
  return (
    <>
      {body.slice(0, start)}
      <span className="ob-run__when">{body.slice(start, end)}</span>
      {body.slice(end)}
    </>
  );
}
