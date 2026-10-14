import type { ReactNode } from 'react';

/**
 * The app marks a listing prints beside its name.
 *
 * Drawn here rather than fetched, for three reasons: a catalogue row would otherwise wait on a
 * vendor CDN, the public pages are statically rendered and cannot depend on a live `apps` row, and
 * a logo is the one thing on a row that must never be a two-letter initial. An app we have no mark
 * for gets a lettered tile in ink, which reads as "an app" rather than as a broken image.
 */

export type AppLogoProps = {
  app_key: string;
  label: string;
  size?: number;
};

export function AppLogo({ app_key, label, size = 20 }: AppLogoProps) {
  const draw = brand_logos[app_key];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={label}
      focusable="false"
    >
      {draw ? draw : lettered_tile(label)}
    </svg>
  );
}

function lettered_tile(label: string): ReactNode {
  return (
    <>
      <rect width="20" height="20" rx="4" fill="#16181a" />
      <text
        x="10"
        y="14.2"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="11"
        fontWeight="700"
        fontFamily="inherit"
      >
        {label.charAt(0).toUpperCase()}
      </text>
    </>
  );
}

const brand_logos: Record<string, ReactNode> = {
  google_sheets: (
    <>
      <path d="M4 1.6h7.4L16 6.2v12.2H4z" fill="#0f9d58" />
      <path d="M11.4 1.6 16 6.2h-4.6z" fill="#0c8043" />
      <path
        d="M6.8 8.4h6.4v6.9H6.8zm.9 1.5v1.3h1.9V9.9zm2.8 0v1.3h1.8V9.9zm-2.8 2.2v1.4h1.9v-1.4zm2.8 0v1.4h1.8v-1.4z"
        fill="#ffffff"
      />
    </>
  ),
  google_drive: (
    <>
      <path d="m7.3 2.2 5.4 9.3H7.3L4.6 6.9z" fill="#00ac47" />
      <path d="M7.3 2.2h5.4l5.4 9.3h-5.4z" fill="#ffba00" />
      <path d="m12.7 11.5 5.4-.1-2.7 4.7H4.7l2.7-4.6z" fill="#0066da" />
      <path d="m7.3 2.2 2.7 4.7-5.4 9.2L2 11.4z" fill="#00832d" opacity="0" />
    </>
  ),
  google_calendar: (
    <>
      <rect x="2.6" y="2.6" width="14.8" height="14.8" rx="1.6" fill="#ffffff" />
      <path d="M2.6 4.2A1.6 1.6 0 0 1 4.2 2.6h11.6a1.6 1.6 0 0 1 1.6 1.6v1.4H2.6z" fill="#4285f4" />
      <path
        d="M2.6 14.4h14.8v1.4a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6z"
        fill="#188038"
      />
      <rect x="2.6" y="2.6" width="14.8" height="14.8" rx="1.6" fill="none" stroke="#dadce0" />
      <text
        x="10"
        y="13.3"
        textAnchor="middle"
        fill="#4285f4"
        fontSize="7.4"
        fontWeight="700"
        fontFamily="inherit"
      >
        31
      </text>
    </>
  ),
  gmail: (
    <>
      <path
        d="M2.4 5.4v9.2h3.2V8.2L10 11.5l4.4-3.3v6.4h3.2V5.4l-2.6-1.8L10 8 5 3.6z"
        fill="#ea4335"
      />
      <path d="M2.4 5.4 5 3.6 10 8v3.5L5.6 8.2v6.4H2.4z" fill="#c5221f" opacity=".25" />
      <path d="M14.4 8.2v6.4h3.2V5.4L15 3.6 10 8v3.5z" fill="#c5221f" opacity=".15" />
    </>
  ),
  slack: (
    <>
      <path
        d="M6.1 12.3a1.7 1.7 0 1 1-1.7-1.7h1.7zm.9 0a1.7 1.7 0 0 1 3.4 0v4.2a1.7 1.7 0 0 1-3.4 0z"
        fill="#e01e5a"
      />
      <path
        d="M7.7 6a1.7 1.7 0 1 1 1.7-1.7v1.7zm0 .9a1.7 1.7 0 0 1 0 3.4H3.5a1.7 1.7 0 0 1 0-3.4z"
        fill="#36c5f0"
      />
      <path
        d="M13.9 7.7a1.7 1.7 0 1 1 1.7 1.7h-1.7zm-.9 0a1.7 1.7 0 0 1-3.4 0V3.5a1.7 1.7 0 0 1 3.4 0z"
        fill="#2eb67d"
      />
      <path
        d="M12.3 13.9a1.7 1.7 0 1 1-1.7 1.7v-1.7zm0-.9a1.7 1.7 0 0 1 0-3.4h4.2a1.7 1.7 0 0 1 0 3.4z"
        fill="#ecb22e"
      />
    </>
  ),
  zendesk: (
    <>
      <path d="M9.2 5v10H2z" fill="#03363d" />
      <path d="M9.2 2.2A3.6 3.6 0 0 1 2 2.2z" fill="#03363d" />
      <path d="M10.8 15V5l7.2 10z" fill="#03363d" />
      <path d="M10.8 17.8a3.6 3.6 0 0 1 7.2 0z" fill="#03363d" />
    </>
  ),
  hubspot: (
    <>
      <circle cx="10" cy="10" r="8" fill="#ff7a59" />
      <path
        d="M13.4 8.1V6.6a1.2 1.2 0 1 0-1.1 0v1.5a3.3 3.3 0 0 0-1.6.7L7.4 6.4a1.3 1.3 0 1 0-.7 1l3.2 2.4a3.2 3.2 0 1 0 3.5-1.7m-1.5 4.7a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4"
        fill="#ffffff"
      />
    </>
  ),
  xero: (
    <>
      <circle cx="10" cy="10" r="8" fill="#13b5ea" />
      <path
        d="M8.3 10 6.5 8.2a.7.7 0 0 1 1-1L9.3 9l1.8-1.8a.7.7 0 0 1 1 1L10.3 10l1.8 1.8a.7.7 0 0 1-1 1L9.3 11l-1.8 1.8a.7.7 0 0 1-1-1z"
        fill="#ffffff"
      />
      <circle cx="14.3" cy="10" r="1" fill="#ffffff" />
    </>
  ),
  linkedin: (
    <>
      <rect width="20" height="20" rx="3" fill="#0a66c2" />
      <rect x="4.2" y="7.9" width="2.4" height="8.1" fill="#ffffff" />
      <circle cx="5.4" cy="5.3" r="1.5" fill="#ffffff" />
      <path
        d="M8.6 16V7.9h2.3v1.1a2.9 2.9 0 0 1 2.5-1.3c1.9 0 3 1.2 3 3.4V16h-2.4v-4.4c0-1.1-.4-1.8-1.4-1.8s-1.7.7-1.7 1.8V16z"
        fill="#ffffff"
      />
    </>
  ),
  notion: (
    <>
      <rect x="1.4" y="1.4" width="17.2" height="17.2" rx="2.6" fill="#ffffff" />
      <rect
        x="1.4"
        y="1.4"
        width="17.2"
        height="17.2"
        rx="2.6"
        fill="none"
        stroke="#16181a"
        strokeWidth="1.1"
      />
      <path d="M6.3 14.4V6h1.9l3.9 5.3V6h1.7v8.4h-1.8L8 8.9v5.5z" fill="#16181a" />
    </>
  ),
  stripe: (
    <>
      <rect width="20" height="20" rx="4" fill="#635bff" />
      <path
        d="M9.6 8.3c0-.5.4-.7 1-.7a5 5 0 0 1 2.3.7V6.2a6 6 0 0 0-2.3-.4c-1.9 0-3.2 1-3.2 2.6 0 2.6 3.5 2.2 3.5 3.3 0 .5-.5.7-1.1.7a5.6 5.6 0 0 1-2.6-.8v2a6.4 6.4 0 0 0 2.6.6c2 0 3.3-1 3.3-2.6 0-2.8-3.5-2.3-3.5-3.3"
        fill="#ffffff"
      />
    </>
  ),
};
