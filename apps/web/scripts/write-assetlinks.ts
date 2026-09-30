/**
 * Write the verified-link fingerprints into the assetlinks route.
 *
 * Reads the fingerprints out of a keystore with keytool rather than taking them on
 * the command line, so they are the keystore's and not a copy of them. A fingerprint
 * typed by hand is a fingerprint typed wrong.
 *
 *   npx tsx scripts/write-assetlinks.ts --keystore=../ilm-release.keystore --alias=ilm
 *
 * Store and key passwords come from KEYSTORE_PASS and KEYPASS in the environment, so
 * they stay out of the shell history and out of this file.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = join(__dirname, '..', 'src', 'app', '.well-known', 'assetlinks.json', 'route.ts');

function main(): void {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const inline = argv.find((a) => a.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const keystore = value('--keystore');
  const alias = value('--alias');
  if (!keystore || !alias) {
    console.error('usage: --keystore=<path> --alias=<alias>');
    process.exit(1);
  }

  const storepass = process.env.KEYSTORE_PASS;
  const keypass = process.env.KEYPASS ?? storepass;
  if (!storepass || !keypass) {
    console.error('KEYSTORE_PASS and KEYPASS must be set in the environment');
    process.exit(1);
  }

  const out = execFileSync(
    'keytool',
    ['-list', '-v', '-keystore', keystore, '-alias', alias, '-storepass', storepass, '-keypass', keypass],
    { encoding: 'utf8' }
  );
  const match = out.match(/SHA256:\s*([A-F0-9:]+)/);
  if (!match) {
    console.error('no SHA256 fingerprint in keytool output — is this the right alias?');
    process.exit(1);
  }
  const fingerprint = match[1];

  const source = readFileSync(ROUTE, 'utf8');
  if (!source.includes('REPLACE_WITH_SHA256_OF_YOUR_RELEASE_KEYSTORE')) {
    console.error('the placeholder is already gone — edit route.ts by hand or reset it');
    process.exit(1);
  }
  writeFileSync(ROUTE, source.replace('REPLACE_WITH_SHA256_OF_YOUR_RELEASE_KEYSTORE', fingerprint));
  console.log(`  wrote ${fingerprint}`);
}

main();