const { execFileSync } = require('node:child_process');

// One build file, two kinds of build. With a Developer ID certificate the build is a release:
// signed, hardened, and notarized by Apple. Without one it is a build for this Mac only, and it
// says so. RELEASING.md has the steps.

// Any one of these sets lets Apple notarize the app. The values stay in the environment.
const sets_of_apple_values = [
  ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  ['APPLE_KEYCHAIN_PROFILE'],
];

const words_for_an_unsigned_build = [
  'THIS BUILD IS UNSIGNED. No "Developer ID Application" certificate is on this Mac.',
  'It runs on this Mac. On another Mac, macOS blocks it with a malware warning. Do not give it to anyone.',
  'RELEASING.md says how to make the signed build.',
].join('\n');

function has_a_developer_id_certificate() {
  if (process.env.CSC_LINK) return true;
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  return identities.includes('Developer ID Application');
}

function require_apple_values() {
  const has_one_full_set = sets_of_apple_values.some((names) =>
    names.every((name) => process.env[name]),
  );
  if (has_one_full_set) return;
  const choices = sets_of_apple_values.map((names) => names.join(' + ')).join(', or ');
  throw new Error(
    `A signed build must be notarized, and the Apple values for that are not set. Set ${choices}. RELEASING.md says where each one comes from.`,
  );
}

const signed_for_everyone = {
  hardenedRuntime: true,
  gatekeeperAssess: false,
  entitlements: 'build/entitlements.mac.plist',
  entitlementsInherit: 'build/entitlements.mac.plist',
  notarize: true,
};

// "-" signs with no certificate, which is the least an Apple Silicon Mac needs to run an app.
const for_this_mac_only = {
  identity: '-',
  hardenedRuntime: false,
  notarize: false,
  artifactName: '${productName}-${version}-${arch}-UNSIGNED.${ext}',
};

// `npm run install-app` builds for this Mac only, also on a Mac that holds the certificate.
const is_signed = !process.env.ALFERA_BUILD_FOR_THIS_MAC && has_a_developer_id_certificate();
if (is_signed) require_apple_values();
else console.warn(`\n${words_for_an_unsigned_build}\n`);

module.exports = {
  appId: 'ai.alfera.desktop',
  productName: 'Alfera',
  files: ['src/**'],
  mac: {
    category: 'public.app-category.productivity',
    icon: 'build/icon.png',
    target: [{ target: 'dmg', arch: ['universal'] }],
    ...(is_signed ? signed_for_everyone : for_this_mac_only),
  },
  // Said again at the end, where the person looks for the result.
  afterAllArtifactBuild: () => {
    if (!is_signed) console.warn(`\n${words_for_an_unsigned_build}\n`);
    return [];
  },
};
