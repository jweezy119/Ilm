/**
 * Build the Android app that wraps Ilm, from start to signed bundle.
 *
 * A Trusted Web Activity is the whole Play Store strategy for a site that already
 * exists: Android opens your domain in a real app shell, so the listing has an icon,
 * a name and a Play install button, and there is no second codebase to keep in sync
 * with the website. Bubblewrap generates the project and builds the bundle.
 *
 * This exists because the two halves have to agree and nothing enforces it. The app
 * declares a package name in its manifest and Digital Asset Links declares the same
 * package name in a JSON file on the site. If they differ, Android fails to verify
 * the link — silently, and the only symptom is a browser address bar appearing
 * inside the app, which reads as a Play problem rather than as a mismatch between
 * two files. So the package name is defined once here and written into both.
 *
 * Prerequisites, none of which can be installed from a script:
 *
 *   A JDK. `java`, `javac` and `keytool` all come from it and Bubblewrap needs all
 *   three. On Debian or Ubuntu:
 *
 *       sudo apt-get install -y openjdk-21-jdk
 *
 *   A release keystore. Created on first run if absent, which is convenient and a
 *   little dangerous: a keystore whose password is lost cannot be replaced without
 *   unpublishing the app, because Android identifies an update by its signing key.
 *   Pass --keystore to point at an existing one.
 *
 * Run:
 *
 *   npx tsx scripts/build-android-twa.ts
 *   npx tsx scripts/build-android-twa.ts --package=com.ilm.app --path=/en
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_ROOT = join(__dirname, '..');
const REPO_ROOT = join(WEB_ROOT, '..', '..');
const ASSETLINKS = join(WEB_ROOT, 'src/app/.well-known/assetlinks.json/route.ts');
const OUT_DIR = join(REPO_ROOT, 'android');

/** The domain the wrapper loads. Must be the origin Play's verification will fetch. */
const HOST = process.env.TWA_HOST ?? 'ilm-web.onrender.com';

const DEFAULTS = {
  package: 'com.ilm.app',
  name: 'Ilm',
  path: '/en',
  keystore: join(REPO_ROOT, 'ilm-release.keystore'),
  alias: 'ilm',
  keyPassword: 'ilmlocalkey',
};

function arg(argv: string[], flag: string, fallback: string): string {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function has(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prints what is missing and how to get it, then stops.
 *
 * Written as a list rather than an error message because the failure mode here is
 * an unfamiliar toolchain: `bubblewrap` failing with "java: not found" tells
 * someone who has not built an Android app before nothing about what to install.
 */
function requirePrerequisites(): void {
  const missing: Array<[string, string]> = [];
  if (!has('java')) missing.push(['java', 'sudo apt-get install -y openjdk-21-jdk']);
  if (!has('keytool')) missing.push(['keytool', 'comes with the JDK — the same install']);
  if (!has('npx')) missing.push(['npx', 'ships with Node']);

  if (missing.length > 0) {
    console.error('\n  Cannot build the Android app yet. Missing:\n');
    for (const [what, how] of missing) console.error(`    ${what.padEnd(10)} ${how}`);
    console.error('\n  Android SDK: build-tools 36.0.0 and platform android-37.0 are present.');
    console.error('  If sdkmanager reports anything missing, install it with:\n');
    console.error('    sdkmanager "platforms;android-37" "build-tools;36.0.0" "platform-tools"\n');
    process.exit(1);
  }
}

function createKeystore(keystore: string, alias: string, keyPassword: string): void {
  console.log(`\n  No keystore at ${keystore}. Creating one.\n`);
  console.log('    Keep it, and keep its passwords. Android identifies an update by its');
  console.log('    signing key, so losing this file means unpublishing the app rather than');
  console.log('    updating it. Back it up somewhere you would not lose a laptop.\n');

  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-v',
      '-keystore', keystore,
      '-alias', alias,
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-storetype', 'PKCS12',
      '-storepass', keyPassword,
      '-keypass', keyPassword,
      '-dname', 'CN=Ilm, OU=Ilm, O=Ilm, L=, S=, C=US',
    ],
    { stdio: 'inherit' }
  );
}

function fingerprintOf(keystore: string, alias: string, storePassword: string): string {
  const out = execFileSync(
    'keytool',
    ['-list', '-v', '-keystore', keystore, '-alias', alias, '-storepass', storePassword],
    { encoding: 'utf8' }
  );
  const match = out.match(/SHA256:\s*([A-F0-9:]+)/);
  if (!match) throw new Error('no SHA256 fingerprint in keytool output — is the alias right?');
  return match[1];
}

/**
 * Writes the package name and fingerprint into the assetlinks route.
 *
 * Both are rewritten every run rather than patched, so a changed package name or a
 * rotated keystore cannot leave the site asserting something the app is not.
 */
function writeAssetlinks(packageName: string, fingerprint: string): void {
  const source = readFileSync(ASSETLINKS, 'utf8');
  const next = source
    .replace(/package_name:\s*'[^']*'/, `package_name: '${packageName}'`)
    .replace(/REPLACE_WITH_SHA256_OF_YOUR_RELEASE_KEYSTORE|BUNDLE_DEBUG_FINGERPRINT_OR_REMOVE|[A-F0-9]{2}(:[A-F0-9]{2}){20,}/g, fingerprint);
  writeFileSync(ASSETLINKS, next);
}

function main(): void {
  const argv = process.argv.slice(2);
  const packageName = arg(argv, '--package', DEFAULTS.package);
  const name = arg(argv, '--name', DEFAULTS.name);
  const path = arg(argv, '--path', DEFAULTS.path);
  const keystore = arg(argv, '--keystore', DEFAULTS.keystore);
  const alias = arg(argv, '--alias', DEFAULTS.alias);
  const keyPassword = arg(argv, '--keypass', DEFAULTS.keyPassword);
  const storePassword = process.env.KEYSTORE_PASS ?? keyPassword;

  requirePrerequisites();

  console.log(`\n  host        ${HOST}`);
  console.log(`  package     ${packageName}`);
  console.log(`  start path  ${path}`);
  console.log(`  keystore    ${keystore}\n`);

  if (!existsSync(keystore)) createKeystore(keystore, alias, keyPassword);

  const fingerprint = fingerprintOf(keystore, alias, storePassword);
  writeAssetlinks(packageName, fingerprint);
  console.log(`\n  assetlinks.json now asserts\n    ${packageName}\n    ${fingerprint}`);

  if (!existsSync(OUT_DIR)) {
    console.log('\n  Generating the Android project (once)...\n');
    execFileSync(
      'npx',
      [
        '@bubblewrap/cli', 'init',
        '--manifestPath', join(WEB_ROOT, 'public/manifest.webmanifest'),
        '--packageId', packageName,
        '--appName', name,
        '--host', HOST,
        '--path', path,
        '--navigationColor', '#065f46',
        '--backgroundColor', '#fdfcfa',
        '--enableNotifications', 'false',
        // A URL bar inside the app is what makes a TWA feel like a webpage. This is
        // the difference between an install and a bookmark, and it is why the
        // assetlinks fingerprint above has to be right.
        '--displayBrowserControls', 'false',
        '--launcherName', name,
        '--iconUrl', join(WEB_ROOT, 'public/icon-512.png'),
        '--splashScreenFadeOutDuration', '200',
        '--versionCode', '1',
        '--output', OUT_DIR,
      ],
      { cwd: REPO_ROOT, stdio: 'inherit' }
    );
  } else {
    console.log(`\n  Android project already exists at ${OUT_DIR}. Reuse it;`);
    console.log('  delete it and run again to regenerate.');
  }

  console.log('\n  Building the signed bundle...\n');
  execFileSync(
    'npx',
    ['@bubblewrap/cli', 'build', '--keys', keystore, '--ksAlias', alias, '--ksPass', `pass:${storePassword}`],
    { cwd: OUT_DIR, stdio: 'inherit' }
  );

  console.log(`
  Done. The bundle is in ${join(OUT_DIR, 'app/build/outputs/bundle/release')}.

  Before uploading to Play:
    1. Set NEXT_PUBLIC_SITE_URL to https://${HOST} and redeploy the site, so the
       assetlinks.json written above is the one being served.
    2. Commit the updated assetlinks route — it now carries a real fingerprint,
       which is public information and belongs in git, unlike the keystore.
    3. Add the .aab to a Play release in the app bundle format.

  Not in git, on purpose:
    ${keystore}
`);
}

main();