import { is_team_mode_switched_on } from '@coworker/config/local_mode_switch';
import { is_product_demo_image_path, is_product_demo_path } from '@/lib/product_demo_path';

const public_paths = new Set([
  '/logos/openai.png',
  '/logos/github.png',
  '/logos/claude.png',
  '/logos/vercel.svg',
  '/auth/callback',
  '/auth/sign-in',
  '/auth/sign-in/google',
  '/auth/sign-in/slack',
  '/auth/email/password',
  '/auth/email/send-code',
  '/auth/email/verify-code',
  '/auth/email/verify-ownership',
  '/auth/test-login',
  '/auth/session',
  '/auth/sign-out',
  '/callback',
  '/sign-in',
  '/sign-up',
  '/connect/start',
  '/connect/callback',
  '/deploy',
]);

const design_system_path = '/design-system';

function is_design_system_path(pathname: string): boolean {
  return pathname === design_system_path || pathname.startsWith(`${design_system_path}/`);
}

export function is_protected_path(
  pathname: string,
  node_environment: string | undefined = process.env.NODE_ENV,
): boolean {
  if (is_product_demo_path(pathname) || is_product_demo_image_path(pathname)) return false;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname === '/_widgets' || pathname.startsWith('/_widgets/')) return false;
  if (pathname === '/join' || pathname.startsWith('/join/')) return false;
  if (is_team_mode_switched_on() && is_page_before_sign_in(pathname)) return false;
  if (pathname === '/monitoring' || pathname.startsWith('/monitoring/')) return false;
  if (is_design_system_path(pathname) && node_environment !== 'production') return false;
  return !public_paths.has(pathname);
}

const pages_before_sign_in = new Set(['/setup', '/sign-in', '/auth/session', '/deploy']);
const calls_before_sign_in = ['/auth/setup/', '/auth/password/'];

export function is_page_before_sign_in(pathname: string): boolean {
  return (
    pages_before_sign_in.has(pathname) ||
    calls_before_sign_in.some((prefix) => pathname.startsWith(prefix))
  );
}
