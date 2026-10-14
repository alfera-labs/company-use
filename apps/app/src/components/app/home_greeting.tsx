import { motion, useReducedMotion } from 'motion/react';
import { memo } from 'react';
import { BrandMark } from '@/components/app/brand_mark';

export const HomeGreeting = memo(function HomeGreeting() {
  const reduce_motion = useReducedMotion();

  return (
    <motion.div
      className="flex flex-col items-center text-center"
      initial={reduce_motion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <AlferaAvatar />
      <h1 className="mt-4 text-balance text-2xl font-medium md:text-3xl">
        Hi, I'm Alfera. What should I get done?
      </h1>
    </motion.div>
  );
});

function AlferaAvatar() {
  return (
    <div className="relative grid size-14 place-items-center rounded-2xl bg-primary shadow-sm">
      <BrandMark className="size-7 text-primary-foreground" />
      <span
        className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full border-[3px] border-background bg-positive"
        aria-hidden="true"
      />
    </div>
  );
}
