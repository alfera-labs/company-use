import type { RatchetRule, RatchetRuleInput } from '@scripts/ratchet/rule_types';
import { is_source_file } from '@scripts/ratchet/source_scope';

const ad_platform_pattern = /gtag\(|fbq\(|googletagmanager\.com|connect\.facebook\.net|@next\/third-parties/gu;

function find_violations({ source_text }: RatchetRuleInput) {
  return source_text.split('\n').flatMap((line, index) =>
    [...line.matchAll(ad_platform_pattern)].map((match) => ({ line: index + 1, message: `ad-platform script "${match[0]}"` })),
  );
}

export const no_ad_platform_scripts_rule: RatchetRule = {
  rule_id: 'no-ad-platform-scripts',
  summary:
    'No `gtag(`, `fbq(`, `googletagmanager.com`, `connect.facebook.net`, or `@next/third-parties` in apps/** and packages/**, test files included. Text match, so strings and comments count too.',
  why: 'An ad-platform script sends visitor data to Google or Meta from the browser. We decided to send conversions from the server only. One approved exception: packages/ui/src/lib/meta_pixel.ts, loaded only after consent. Its conversion events (track_meta_event) must carry the event id the API sends for the same moment, so Meta keeps one.',
  how_to_fix:
    'Delete the script. Record the conversion on the API side and send it from the server.',
  applies_to: is_source_file,
  find_violations,
  self_test_samples: [
    {
      file_path: 'apps/app/src/sample.tsx',
      source_text:
        "gtag('event', 'signup');\nfbq('track', 'Lead');\nconst src = 'https://www.googletagmanager.com/gtag/js';\nconst px = 'https://connect.facebook.net/en_US/fbevents.js';\nimport { GoogleAnalytics } from '@next/third-parties/google';\n",
      expected_count: 5,
    },
    {
      file_path: 'apps/app/src/sample.tsx',
      source_text: "posthog.capture('signup');\nconst tag = 'gtag';\nconst host = 'facebook.com';\n",
      expected_count: 0,
    },
  ],
};
