/** Full rolling API + JSON; throughput/CPU batches and a separate per-call pass. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import * as dicecore from '../dist/index.js';

const newDigest = () => ({ count: 0, total: 0, weightedTotal: 0, randomCalls: 0, encodedLength: 0 });
if (!isMainThread) {
  const request = workerData;
  let engine, options, input, lastResult, lastJSON, latencySamples;
  const run = localIndex => {
    lastResult = engine.roll(input, options[localIndex]);
    lastJSON = JSON.stringify(lastResult);
  };
  const update = (digest, index) => {
    digest.count++;
    digest.total += lastResult.total;
    digest.weightedTotal += (index + 1) * lastResult.total;
    digest.randomCalls += lastResult.stats.randomCalls;
    digest.encodedLength += lastJSON.length;
  };
  parentPort.on('message', message => {
    if (message.type === 'prepare') {
      engine = dicecore.createDiceEngine({ freezeResults: 'never', randomAlgorithm: 'mt19937' });
      input = message.workload.input;
      options = [];
      for (let index = request.worker; index < request.requests; index += request.workers) options.push({ seed: request.seedPrefix + index, randomAlgorithm: 'mt19937' });
      if (request.phase === 'preflight') {
        const values = [];
        for (let position = request.worker; position < request.validationIndices.length; position += request.workers) {
          const index = request.validationIndices[position];
          const json = JSON.stringify(engine.roll(input, { seed: request.seedPrefix + index, randomAlgorithm: 'mt19937' }));
          values.push({ position, index, json, encodedLength: json.length });
        }
        parentPort.postMessage({ type: 'preflight', values });
        return;
      }
      latencySamples = new Array(Math.floor((request.latencyRequests - 1 - request.worker) / request.workers) + 1).fill(0);
      for (let index = 0; index < request.warmup; index++) run(index % options.length);
      parentPort.postMessage({ type: 'ready' });
    } else if (message.type === 'start') {
      const digest = newDigest();
      for (let index = request.worker; index < request.requests; index += request.workers) {
        run(Math.floor(index / request.workers));
        update(digest, index);
      }
      parentPort.postMessage({ type: 'done', digest });
    } else if (message.type === 'latency') {
      const digest = newDigest();
      for (let index = request.worker; index < request.latencyRequests; index += request.workers) {
        const started = process.hrtime.bigint();
        run(Math.floor(index / request.workers));
        latencySamples[Math.floor(index / request.workers)] = Number(process.hrtime.bigint() - started);
        update(digest, index);
      }
      parentPort.postMessage({ type: 'latency', samplesNs: latencySamples, digest });
    } else if (message.type === 'release') {
      parentPort.postMessage({ type: 'released', lastResultType: lastResult?.type, lastJSONLength: lastJSON?.length });
      lastResult = lastJSON = latencySamples = undefined;
    }
  });
} else {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  assert.ok(Number.isInteger(request.workers) && request.workers > 0 && request.requests >= request.workers && request.latencyRequests >= request.workers && request.latencyRequests <= request.requests && request.samples > 0 && request.warmup >= 0);
  assert.ok(request.phase === 'preflight' || request.phase === 'measure');
  assert.equal(request.engineMode, 'pool');
  assert.ok(request.workloads.every(workload => workload.mode === 'full'));
  const pool = Array.from({ length: request.workers }, (_, worker) => new Worker(new URL(import.meta.url), { workerData: { ...request, worker } }));
  const exchange = (worker, message, expected) => new Promise((resolve, reject) => {
    const cleanup = () => { worker.off('message', success); worker.off('error', failure); worker.off('exit', exited); };
    const success = value => { cleanup(); if (value.type !== expected) reject(new Error(`Expected ${expected}, got ${value.type}`)); else resolve(value); };
    const failure = error => { cleanup(); reject(error); };
    const exited = code => failure(new Error(`Worker exited before ${expected}: ${code}`));
    worker.once('message', success); worker.once('error', failure); worker.once('exit', exited); worker.postMessage(message);
  });
  const combine = values => {
    const digest = newDigest();
    for (const value of values) for (const key of Object.keys(digest)) digest[key] += value.digest[key];
    return digest;
  };
  const cases = {}, memory = {}, latency = {};
  const rss = () => ({ available: true, rssBytes: process.memoryUsage().rss, source: 'process.memoryUsage().rss' });
  const cpu = () => {
    const value = process.cpuUsage();
    return { available: true, userNs: value.user * 1000, systemNs: value.system * 1000, source: 'process.cpuUsage: user+system, process-wide' };
  };
  try {
    for (const workload of request.workloads) {
      const ready = await Promise.all(pool.map(worker => exchange(worker, { type: 'prepare', workload }, request.phase === 'preflight' ? 'preflight' : 'ready')));
      if (request.phase === 'preflight') {
        cases[workload.id] = ready.flatMap(value => value.values).sort((a, b) => a.position - b.position).map(({ index, json, encodedLength }) => ({ index, json, encodedLength }));
        continue;
      }
      cases[workload.id] = [];
      memory[workload.id] = { afterWarmup: rss(), afterBatches: [] };
      for (let sample = 0; sample < request.samples; sample++) {
        const before = cpu(), started = process.hrtime.bigint();
        const results = await Promise.all(pool.map(worker => exchange(worker, { type: 'start' }, 'done')));
        const durationNs = Number(process.hrtime.bigint() - started), after = cpu();
        memory[workload.id].afterBatches.push(rss());
        const userNs = after.userNs - before.userNs, systemNs = after.systemNs - before.systemNs;
        cases[workload.id].push({ durationNs, requests: request.requests, workers: request.workers, digest: combine(results),
          cpu: { available: true, userNs, systemNs, totalNs: userNs + systemNs, source: after.source, before, after } });
      }
      const samples = await Promise.all(pool.map(worker => exchange(worker, { type: 'latency' }, 'latency')));
      latency[workload.id] = { samplesByWorkerNs: samples.map(value => value.samplesNs), requests: request.latencyRequests, digest: combine(samples) };
      await Promise.all(pool.map(worker => exchange(worker, { type: 'release' }, 'released')));
    }
  } finally { await Promise.all(pool.map(worker => worker.terminate())); }
  process.stdout.write(`DICECORE_NODE_COMPARE ${JSON.stringify({ runtime: process.version, encoder: 'JSON.stringify', clock: { source: 'process.hrtime.bigint' }, cases, memory, latency })}\n`);
}
