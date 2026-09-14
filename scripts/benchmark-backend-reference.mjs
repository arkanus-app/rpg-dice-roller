/** Node/Bun worker-pool benchmark. A batch timer encloses dispatch and completion. */
import { readFileSync } from 'node:fs';
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import * as dicecore from '../dist/index.js';

if (!isMainThread) {
  const request = workerData;
  let run;
  let options;
  let lastResult;
  parentPort.on('message', message => {
    if (message.type === 'prepare') {
      const engine = dicecore.createDiceEngine({ freezeResults:'never', randomAlgorithm:'mt19937' });
      options = [];
      for(let index=request.worker;index<request.requests;index+=request.workers) options.push({seed:request.seedPrefix+index,randomAlgorithm:'mt19937'});
      const methods = {full:'roll',details:'rollDetails',summary:'rollSummary'};
      run = option => engine[methods[message.workload.mode]](message.workload.input,option);
      if (request.phase === 'preflight') {
        const values = [];
        for(let index=request.worker;index<request.validationIndices.length;index+=request.workers) {
          const seedIndex=request.validationIndices[index];
          values.push({position:index,index:seedIndex,value:run({seed:request.seedPrefix+seedIndex,randomAlgorithm:'mt19937'})});
        }
        parentPort.postMessage({type:'preflight',values});
        return;
      }
      const count=Math.floor((request.requests-1-request.worker)/request.workers)+1;
      for(let index=0;index<request.warmup;index++) lastResult=run(options[index%count]);
      parentPort.postMessage({type:'ready'});
    } else if (message.type === 'start') {
      const digest={count:0,total:0,weightedTotal:0,randomCalls:0};
      for(let index=request.worker;index<request.requests;index+=request.workers) {
        const value=run(options[Math.floor(index/request.workers)]);
        lastResult=value;
        digest.count++;
        digest.total+=value.total;
        digest.weightedTotal+=(index+1)*value.total;
        digest.randomCalls+=value.stats.randomCalls;
      }
      parentPort.postMessage({type:'done',digest});
    } else if (message.type === 'release') {
      parentPort.postMessage({type:'released',lastResultType:lastResult?.type});
      lastResult=undefined;
    }
  });
} else {
  const request=JSON.parse(readFileSync(0,'utf8'));
  const pool=Array.from({length:request.workers},(_,worker)=>new Worker(new URL(import.meta.url),{workerData:{...request,worker}}));
  const exchange=(worker,message)=>new Promise((resolve,reject)=>{
    const success=value=>{worker.off('error',failure);resolve(value);};
    const failure=error=>{worker.off('message',success);reject(error);};
    worker.once('message',success);worker.once('error',failure);worker.postMessage(message);
  });
  const cases={};
  const memory={};
  const rss=()=>({available:true,rssBytes:process.memoryUsage().rss,source:'process.memoryUsage().rss'});
  try {
    for(const workload of request.workloads) {
      const prepared=await Promise.all(pool.map(worker=>exchange(worker,{type:'prepare',workload})));
      if(request.phase==='preflight') {
        cases[workload.id]=prepared.flatMap(value=>value.values).sort((a,b)=>a.position-b.position).map(({index,value})=>({index,value}));
        continue;
      }
      if(prepared.some(value=>value.type!=='ready')) throw new Error('Worker failed readiness barrier');
      cases[workload.id]=[];
      memory[workload.id]={afterWarmup:rss(),afterBatches:[]};
      for(let sample=0;sample<request.samples;sample++) {
      const started=process.hrtime.bigint();
      const results=await Promise.all(pool.map(worker=>exchange(worker,{type:'start'})));
      const durationNs=Number(process.hrtime.bigint()-started);
      memory[workload.id].afterBatches.push(rss());
      const digest={count:0,total:0,weightedTotal:0,randomCalls:0};
      for(const result of results) for(const key of Object.keys(digest)) digest[key]+=result.digest[key];
      cases[workload.id].push({durationNs,requests:request.requests,workers:request.workers,digest,nsPerOp:durationNs/request.requests,opsPerSecond:request.requests*1e9/durationNs});
      }
      await Promise.all(pool.map(worker=>exchange(worker,{type:'release'})));
    }
  } finally { await Promise.all(pool.map(worker=>worker.terminate())); }
  process.stdout.write(`DICECORE_BACKEND ${JSON.stringify({runtime:process.versions.bun ? `Bun ${process.versions.bun}` : process.version,cases,memory})}\n`);
}
