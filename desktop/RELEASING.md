# Release the Mac app

A release is one file: `Alfera-<version>-universal.dmg`. It runs on Apple Silicon and on Intel.
Apple must sign it and notarize it, or macOS blocks it on every Mac that downloads it.

## What you need, once

1. A membership of the Apple Developer Program.
2. A certificate of the kind "Developer ID Application" in the login keychain of the Mac that
   builds. Make it in Xcode: Settings, Accounts, Manage Certificates, "+", Developer ID
   Application. Check that the Mac has it:

   ```bash
   security find-identity -v -p codesigning    # must list "Developer ID Application: ..."
   ```

3. The values Apple needs to notarize, in environment variables. Use ONE of these three sets.
   Never write the values into a file of this repository.

   | Set | Variables | Where the values come from |
   |---|---|---|
   | API key (best for a build server) | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect, Users and Access, Integrations, Team Keys. `APPLE_API_KEY` is the path of the downloaded `.p8` file. |
   | Apple ID | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | The Apple ID email, a password made at account.apple.com under "App-Specific Passwords", and the team ID from the membership page. |
   | Keychain profile (best for a person's Mac) | `APPLE_KEYCHAIN_PROFILE` | Save the values once with `xcrun notarytool store-credentials <name>`, then set the variable to that name. |

   A build server with no keychain also needs the certificate as a file: `CSC_LINK` (the path of
   the exported `.p12` file) and `CSC_KEY_PASSWORD` (its password).

## Release

1. Set `version` in `package.json`.
2. Build, sign and notarize with one command:

   ```bash
   npm ci
   npm run dist
   ```

   It writes `dist/Alfera-<version>-universal.dmg`. Notarization waits for Apple and takes a
   few minutes. If the certificate is there and the Apple values are not, the command stops
   before it builds and names the variables that are missing.

3. Check the result before anyone gets it:

   ```bash
   codesign --verify --deep --strict --verbose=2 dist/mac-universal/Alfera.app
   spctl -a -vv dist/mac-universal/Alfera.app      # must say: accepted, source=Notarized Developer ID
   xcrun stapler validate dist/mac-universal/Alfera.app
   ```

4. The DMG is the download. Nothing here uploads it.

## How the build decides

`electron-builder.cjs` looks for the certificate each time it runs.

- **Certificate found:** hardened runtime on, the entitlements in
  `build/entitlements.mac.plist` (one: the JavaScript engine may write machine code), signed,
  notarized.
- **No certificate:** the build still works, for the Mac it was built on. It prints
  `THIS BUILD IS UNSIGNED` at the start and at the end, and the file is named
  `Alfera-<version>-universal-UNSIGNED.dmg`.

`npm run install-app` always makes the second kind, because it builds for the Mac it runs on.

## An unsigned build is an early build

Until the Developer ID certificate exists, the download is the `UNSIGNED` DMG, and the README
says next to the link how to open it (System Settings, Privacy & Security, "Open Anyway").
Once the certificate exists, only signed builds ship. What a person sees with an unsigned build:

An unsigned build opens on the Mac that built it. On any other Mac, a person who downloads it
and opens it sees a macOS warning that Apple could not verify the app is free of malware, with
the buttons "Done" and "Move to Trash" and no button to open it. The only way past it is System
Settings, Privacy & Security, "Open Anyway". Many people stop at the warning. So:

- Never rename an `UNSIGNED` file: the name tells people what they have.
- Never ship an unsigned build without the "Open Anyway" step next to its link.

## Updates

To update, download the new DMG and replace the app. The app is for Mac only.
