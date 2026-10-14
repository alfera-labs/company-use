import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { OfferApps, StagedOffer } from '@/components/onboarding/reveal_staged_offer';
import { format_reveal_subtitle } from '@/components/onboarding/reveal_subtitle';
import { usePrefersReducedMotion } from '@/components/onboarding/use_prefers_reduced_motion';
import type { CompanyScan, CompanyScanFinding } from '@/lib/api';

const rise = [0.22, 1, 0.36, 1] as const;

export function RevealStep({
  scan,
  onAdvance,
}: {
  scan: CompanyScan;
  onAdvance: (picked_job: CompanyScanFinding | undefined) => void;
}) {
  const reduce_motion = usePrefersReducedMotion();
  const [staged_index, set_staged_index] = useState(0);
  const staged = scan.findings[staged_index];
  const rises_in = (delay: number) => ({
    animate: { opacity: 1, transform: 'translateY(0px)' },
    initial: reduce_motion ? false : { opacity: 0, transform: 'translateY(12px)' },
    transition: reduce_motion ? { duration: 0 } : { duration: 0.55, ease: rise, delay },
  });
  const stage_ref = useRef<HTMLDivElement>(null);
  const stage = (index: number) => {
    if (reduce_motion) set_staged_index(index);
    else morph_between_offers(() => set_staged_index(index));
    stage_ref.current?.focus({ preventScroll: true });
  };
  const company = scan.company_name.trim();

  return (
    <div className="ob-step">
      <motion.h1 className="ob-title" {...rises_in(0)}>
        Just say <span className="ob-accent">the word</span>
      </motion.h1>
      <motion.p className="ob-subtitle" {...rises_in(0.08)}>
        {format_reveal_subtitle(company)}
      </motion.p>
      {staged ? (
        <motion.div className="ob-reveal__stage" ref={stage_ref} tabIndex={-1} {...rises_in(0.25)}>
          <StagedOffer finding={staged} index={staged_index} reduceMotion={reduce_motion} />
        </motion.div>
      ) : null}
      {scan.findings.length > 1 ? (
        <motion.div className="ob-waiting" {...rises_in(0.5)}>
          <WaitingOffers offers={scan.findings} onPick={stage} stagedIndex={staged_index} />
        </motion.div>
      ) : null}
      <motion.div className="ob-actions ob-reveal__actions" {...rises_in(0.7)}>
        <button className="ob-btn" type="button" onClick={() => onAdvance(staged)}>
          Get to work
        </button>
      </motion.div>
    </div>
  );
}

let latest_morph: ViewTransition | null = null;

function morph_between_offers(swap: () => void) {
  if (!document.startViewTransition) return swap();
  const root = document.documentElement;
  root.classList.add('ob-morphing');
  const morph = document.startViewTransition(() => flushSync(swap));
  latest_morph = morph;
  void morph.finished.finally(() => {
    if (latest_morph === morph) root.classList.remove('ob-morphing');
  });
}

function WaitingOffers({
  offers,
  stagedIndex,
  onPick,
}: {
  offers: CompanyScanFinding[];
  stagedIndex: number;
  onPick: (index: number) => void;
}) {
  const waiting = offers.map((finding, index) => ({ finding, index }));
  return waiting
    .filter((offer) => offer.index !== stagedIndex)
    .map(({ finding, index }) => (
      <button
        className="ob-waiting__row"
        key={index}
        onClick={() => onPick(index)}
        style={{ viewTransitionName: `ob-waiting-offer-${index}` }}
        type="button"
      >
        <span className="ob-waiting__say">{finding.offer ?? finding.body}</span>
        <OfferApps tools={finding.tools} />
        <ChevronRight aria-hidden="true" className="ob-waiting__chevron" />
      </button>
    ));
}
