#!/usr/bin/env node
// Generates a stable RSA key for the extension so its ID never changes.
//   node tools/gen-key.mjs          -> creates tools/extension-key.pem (if missing),
//                                      writes "key" into extension/manifest.json, prints ID
//   node tools/gen-key.mjs --id     -> prints the extension ID from manifest.json "key"
import { generateKeyPairSync, createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pemPath = join(root, 'tools', 'extension-key.pem');
const manifestPath = join(root, 'extension', 'manifest.json');

export function idFromDer(der) {
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

if (process.argv.includes('--id')) {
  const key = readManifest().key;
  if (!key) {
    console.error('manifest.json has no "key". Run without --id first.');
    process.exit(1);
  }
  process.stdout.write(idFromDer(Buffer.from(key, 'base64')));
  process.exit(0);
}

let privateKey;
if (existsSync(pemPath)) {
  privateKey = createPrivateKey(readFileSync(pemPath));
} else {
  ({ privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }));
  writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
}
const der = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const manifest = readManifest();
manifest.key = der.toString('base64');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(idFromDer(der));
