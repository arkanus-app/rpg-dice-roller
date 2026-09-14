/** Check archived source overlays and their measurement/binary references.
 * No builds, tests, benchmarks, source restoration or executable invocation.
 * node go/benchmarks/optimization-round6/sources/verify.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => readFileSync(path.join(root, file));
const manifest = JSON.parse(read('go/benchmarks/optimization-round6/sources/manifest.json'));
assert.equal(manifest.schemaVersion, 1);
assert.ok(manifest.base.commit.startsWith('f107265'));
assert.equal(manifest.build.toolchain, 'go1.26.2');
assert.equal(manifest.build.environment.CGO_ENABLED, '0');
let sourceCount = 0, binaryCount = 0;
function verify(record) {
  const bytes = read(record.path);
  assert.equal(hash(bytes), record.sha256, `Hash mismatch: ${record.path}`);
  assert.equal(bytes.length, record.bytes, `Length mismatch: ${record.path}`);
}
for (const [id, variant] of Object.entries(manifest.variants)) {
  assert.equal(variant.baseCommit, manifest.base.commit);
  assert.equal(variant.measurementStatus, 'complete');
  assert.equal(variant.decision, id === 'h1-arena' || id === 'h4-arena-stack' ? 'rejected' : 'accepted');
  for (const source of variant.files) {
    assert.ok(source.target.startsWith('go/') && source.target.endsWith('.go'));
    verify({ path: source.archive, sha256: source.sha256, bytes: source.bytes });
    sourceCount++;
  }
  verify(variant.measurement);
  const measured = JSON.parse(read(variant.measurement.path));
  assert.equal(measured.status, 'complete');
  assert.equal(measured.label, id);
  assert.equal(measured.binaries.before.sha256, manifest.binaries.baseline.sha256);
  assert.equal(measured.binaries.after.sha256, manifest.binaries[variant.binary].sha256);
  for (const [which, output] of Object.entries(variant.outputs)) {
    verify(output);
    assert.equal(output.sha256, measured.outputs[which].sha256);
  }
  console.log(`PASS ${id}: ${variant.files.length} exact-byte source files; ${variant.decision}`);
}
for (const [id, binary] of Object.entries(manifest.binaries)) {
  if (!existsSync(path.join(root, binary.path))) {
    console.log(`NOTE ${id}: optional local executable absent (${binary.sha256})`);
    continue;
  }
  verify(binary); binaryCount++;
}
console.log(`PASS ${sourceCount} archived files, four measurements, ${binaryCount} available executables. No code executed.`);
