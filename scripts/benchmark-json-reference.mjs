/** JSON construction/encoding benchmark worker; no HTTP or payload transfer. */
import { readFileSync } from 'node:fs';
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import * as dicecore from '../dist/index.js';

if (!isMainThread) {
  const request = workerData;
  let engine, options, prepared, input, lastResult, lastJSON;
  const run = localIndex => {
    lastResult = request.operation === 'encoding-only' ? prepared[localIndex] : engine.roll(input, options[localIndex]);
    lastJSON = JSON.stringify(lastResult);
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
      prepared = request.operation === 'encoding-only' ? options.map(option => engine.roll(input, option)) : undefined;
      for (let index = 0; index < request.warmup; index++) run(index % options.length);
      parentPort.postMessage({ type: 'ready' });
    } else if (message.type === 'start') {
      const digest = { count: 0, total: 0, weightedTotal: 0, randomCalls: 0, encodedLength: 0 };
      for (let index = request.worker; index < request.requests; index += request.workers) {
        run(Math.floor(index / request.workers));
        digest.count++;
        digest.total += lastResult.total;
        digest.weightedTotal += (index + 1) * lastResult.total;
        digest.randomCalls += lastResult.stats.randomCalls;
        digest.encodedLength += lastJSON.length;
      }
      parentPort.postMessage({ type: 'done', digest });
    } else if (message.type === 'release') {
      parentPort.postMessage({ type: 'released', lastResultType: lastResult?.type, lastJSONLength: lastJSON?.length });
      lastResult = lastJSON = prepared = undefined;
    }
  });
} else {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const pool = Array.from({ length: request.workers }, (_, worker) => new Worker(new URL(import.meta.url), { workerData: { ...request, worker } }));
  const exchange = (worker, message) => new Promise((resolve, reject) => {
    const success = value => { worker.off('error', failure); resolve(value); };
    const failure = error => { worker.off('message', success); reject(error); };
    worker.once('message', success); worker.once('error', failure); worker.postMessage(message);
  });
  const cases = {}, memory = {};
  const rss = () => ({ available: true, rssBytes: process.memoryUsage().rss, source: 'process.memoryUsage().rss' });
  try {
    for (const workload of request.workloads) {
      const ready = await Promise.all(pool.map(worker => exchange(worker, { type: 'prepare', workload })));
      if (request.phase === 'preflight') {
        cases[workload.id] = ready.flatMap(value => value.values).sort((a, b) => a.position - b.position).map(({ index, json, encodedLength }) => ({ index, json, encodedLength }));
        continue;
      }
      if (ready.some(value => value.type !== 'ready')) throw new Error('Failed JSON readiness barrier');
      cases[workload.id] = [];
      memory[workload.id] = { afterWarmup: rss(), afterBatches: [] };
      for (let sample = 0; sample < request.samples; sample++) {
        const started = process.hrtime.bigint();
        const results = await Promise.all(pool.map(worker => exchange(worker, { type: 'start' })));
        const durationNs = Number(process.hrtime.bigint() - started);
        memory[workload.id].afterBatches.push(rss());
        const digest = { count: 0, total: 0, weightedTotal: 0, randomCalls: 0, encodedLength: 0 };
        for (const result of results) for (const key of Object.keys(digest)) digest[key] += result.digest[key];
        cases[workload.id].push({ durationNs, requests: request.requests, workers: request.workers, digest, opsPerSecond: request.requests * 1e9 / durationNs });
      }
      await Promise.all(pool.map(worker => exchange(worker, { type: 'release' })));
    }
  } finally {
    await Promise.all(pool.map(worker => worker.terminate()));
  }
  process.stdout.write(`DICECORE_JSON ${JSON.stringify({ runtime: process.versions.bun ? `Bun ${process.versions.bun}` : process.version, cases, memory })}\n`);
}
