export function is_sandbox_preview_host(host: string, base_domain: string) {
  return Boolean(host && base_domain && host !== base_domain && host.endsWith(`.${base_domain}`));
}

// Paths that carry no session and must never meet the sign-in gate. `/_build/` is the base the
// TanStack Start client bundle is served from, and `/assets/` holds the files Vite emits beside
// it. The rest are files in public/, plus the three names browsers and crawlers ask for on their
// own whether or not a route answers them.
export function is_static_asset_request(pathname: string) {
  return (
    pathname.startsWith('/_build/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/document-viewer-licenses/') ||
    pathname.startsWith('/document-viewers/') ||
    pathname.startsWith('/logos/') ||
    pathname === '/pptx-react-viewer.css' ||
    pathname === '/favicon.ico' ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt'
  );
}
