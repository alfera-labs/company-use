import { Link, type LinkComponentProps } from '@tanstack/react-router';
import { useState } from 'react';

type AppNavLinkProps = Omit<LinkComponentProps<'a'>, 'preload'>;

export function AppNavLink({
  children,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...link_props
}: AppNavLinkProps) {
  const [is_warm, set_is_warm] = useState(false);
  const warm_on_intent = () => set_is_warm(true);

  return (
    <Link
      {...link_props}
      preload={is_warm ? 'render' : 'intent'}
      onMouseEnter={(event) => {
        warm_on_intent();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        warm_on_intent();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        warm_on_intent();
        onTouchStart?.(event);
      }}
    >
      {children}
    </Link>
  );
}
