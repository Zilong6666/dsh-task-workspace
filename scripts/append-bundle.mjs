/**
 * Append a package name to `dsh.profile.bundles` in a profile's package.json,
 * editing only that array in place.
 *
 * The owning application rewrites this file itself, so the rest of the bytes
 * (key order, indentation, trailing newline) must survive untouched — a
 * JSON.parse/stringify round trip is not good enough here.
 *
 *   node scripts/append-bundle.mjs <profile>/package.json <package-name> [--dry-run]
 *
 * Idempotent. Writes `<package.json>.bak` before the first change.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const [file, name] = process.argv.slice(2);
const dryRun = process.argv.includes('--dry-run');

if (!file || !name) {
  console.error('usage: node scripts/append-bundle.mjs <package.json> <package-name> [--dry-run]');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error(`not valid JSON: ${file}: ${error.message}`);
  process.exit(1);
}

const bundles = parsed?.dsh?.profile?.bundles ?? [];
if (bundles.includes(name)) {
  console.log(`bundle    : already listed`);
  process.exit(0);
}
if (dryRun) {
  console.log(`bundle    : would append ${name}`);
  process.exit(0);
}

/** Find the end of the `"bundles": [` array, assuming one bundle list per profile. */
const marker = /"bundles"\s*:\s*\[/.exec(raw);
if (marker === null) {
  console.error(`cannot find a "bundles" array in ${file}`);
  process.exit(1);
}

const open = marker.index + marker[0].length;
const close = raw.indexOf(']', open);
if (close === -1) {
  console.error(`unterminated "bundles" array in ${file}`);
  process.exit(1);
}

const body = raw.slice(open, close);
const trimmed = body.replace(/\s+$/, '');
const lineStart = raw.lastIndexOf('\n', marker.index) + 1;
const indent = /^[ \t]*/.exec(raw.slice(lineStart, marker.index))[0];
const needsComma = trimmed.length > 0 && !trimmed.endsWith(',');

const patched =
  raw.slice(0, open) +
  trimmed +
  (needsComma ? ',' : '') +
  `\n${indent}  ${JSON.stringify(name)}\n${indent}` +
  raw.slice(close);

if (!existsSync(`${file}.bak`)) copyFileSync(file, `${file}.bak`);
writeFileSync(file, patched);
console.log(`bundle    : appended ${name} (backup: ${file.split('/').pop()}.bak)`);
