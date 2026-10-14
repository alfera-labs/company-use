import type { TemplateLinkProps } from '@coworker/ui/components/templates-catalog';
import { AppNavLink } from '@/components/app/app_nav_link';

/**
 * The link every href on the templates surface goes through, in the app.
 *
 * The shared components render a plain anchor by default, which inside the App Router is a full
 * document navigation: the shell reboots, the query cache is thrown away, and a filter click
 * costs about a second. AppNavLink prefetches the route's shell on sight and its content on
 * hover, so the same click swaps one segment and the skeleton covers the rest.
 */
export function TemplatesLink({ href, className, children, ...props }: TemplateLinkProps) {
  return (
    <AppNavLink href={href} className={className} aria-current={props['aria-current']}>
      {children}
    </AppNavLink>
  );
}
