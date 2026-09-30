/*
 * Proves to Android that this domain is allowed to be the app's verified link host.
 *
 * Without this file the Trusted Web Activity launches but shows a browser address
 * bar, or Android refuses to verify the link at all. With it, the app opens with its
 * own icon and name and the URL bar is gone — which is most of what makes an install
 * feel like an app rather than a bookmark.
 *
 * The two values below have to come from the Android release keystore, not from
 * anything in this repository, so they are placeholders and they are deliberately
 * obviously wrong: a syntactically valid but incorrect fingerprint would fail
 * verification silently, and the symptom — a browser bar appearing inside the app —
 * looks like a Play Store problem rather than a bad file.
 *
 * Get them with:
 *
 *   keytool -list -v -keystore release.keystore -alias ilm \
 *           -storepass "$PASS" -keypass "$KEYPASS" | grep 'SHA256:'
 *
 * Then write them in, or run scripts/write-assetlinks.ts, which takes the keystore
 * path and does it. Do not commit a real release keystore, and do not commit the
 * fingerprint of a keystore you have lost the password to.
 */

const FINGERPRINT_PLACEHOLDER = 'REPLACE_WITH_SHA256_OF_YOUR_RELEASE_KEYSTORE';

const FINGERPRINTS = [
  /*
   * The release keystore. This is the one that matters for anything a user
   * installs, and it is the one that must never be lost.
   */
  FINGERPRINT_PLACEHOLDER,
  /*
   * The debug keystore, so that a locally installed build verifies too.
   *
   * Worth the extra entry only while developing; a shipped `assetlinks.json` with a
   * debug fingerprint in it is not a security problem — debug keys are public — but
   * it is noise, and it invites the question of what else is in this file.
   */
  'BUNDLE_DEBUG_FINGERPRINT_OR_REMOVE',
];

const doc = {
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: 'com.ilm.app',
    sha256_cert_fingerprints: FINGERPRINTS,
  },
};

export function GET(): Response {
  return new Response(JSON.stringify(doc, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}