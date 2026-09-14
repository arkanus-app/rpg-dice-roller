/** Losslessly archive the complete, repetitive preflight JSON after measurement. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'go/benchmarks/backend-preflight-final.json');
const report = path.join(root, 'go/benchmarks/backend-final.json');
const raw = JSON.parse(readFileSync(report, 'utf8'));
assert.equal(raw.status, 'complete');
assert.equal(raw.preflight.passed, true);
const bytes = readFileSync(source);
const checksum = data => createHash('sha256').update(data).digest('hex');
const sha256 = checksum(bytes);
const archive = gzipSync(bytes, { level: 9 });
assert.deepEqual(gunzipSync(archive), bytes, 'Archive must preserve every byte');
const localArchive = path.join(root, '.artifacts/benchmark-calibration/preflight-archive');
mkdirSync(localArchive, { recursive: true });
writeFileSync(path.join(localArchive, `${sha256}.json`), bytes);
writeFileSync(source + '.gz', archive);
assert.equal(checksum(gunzipSync(readFileSync(source + '.gz'))), sha256);
raw.preflight.originalFile = 'go/benchmarks/backend-preflight-final.json';
raw.preflight.file = raw.preflight.originalFile + '.gz';
raw.preflight.storage = { encoding: 'gzip', uncompressedBytes: bytes.length, compressedBytes: archive.length, uncompressedSha256: sha256, compressedSha256: checksum(archive), note: 'Lossless post-measurement archival; all outputs and measurements unchanged.' };
writeFileSync(report, JSON.stringify(raw, null, 2) + '\n');
// Only remove this generated JSON after both retained copies have been checked.
assert.equal(checksum(readFileSync(path.join(localArchive, `${sha256}.json`))), sha256);
unlinkSync(source);
console.log(`Archived ${bytes.length} bytes as ${archive.length} bytes; SHA-256 ${sha256}`);
