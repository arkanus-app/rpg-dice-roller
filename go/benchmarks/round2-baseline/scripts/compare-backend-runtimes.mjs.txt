/** Backend library batches: Node/Bun worker pools and Go goroutines; no HTTP. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
let go=process.env.GO_BINARY??'go', bun=process.env.BUN_BINARY??'bun', quick=false, preflightOnly=false;
const args=process.argv.slice(2);
for(let index=0;index<args.length;index++) {
  if(args[index]==='--go'&&args[index+1]) go=args[++index];
  else if(args[index]==='--bun'&&args[index+1]) bun=args[++index];
  else if(args[index]==='--quick') quick=true;
  else if(args[index]==='--preflight-only') preflightOnly=true;
  else throw new Error(`Unknown argument ${args[index]}`);
}
const started=Date.now(), deadline=started+300000;
const mode=preflightOnly?'preflight':quick?'quick':'final';
const directory=path.join(root,quick||preflightOnly?'.artifacts/benchmark-calibration':'go/benchmarks');
mkdirSync(directory,{recursive:true});
const rawPath=path.join(directory,`backend-${mode}.json`);
const preflightPath=path.join(directory,`backend-preflight-${mode}.json`);
const binary=path.join(root,'.artifacts',`dicecore-backend${process.platform==='win32'?'.exe':''}`);
const runtimes=['node','bun','go-pool','go-shared'];
const workloads=[];
for(const [id,input] of [['d20','1d20+5'],['100d6','100d6'],['pool','20d6!2ro=1kh10']]) {
  for(const resultMode of ['full','details','summary']) workloads.push({id:`${id}-${resultMode}`,label:`${input} · ${resultMode}`,input,mode:resultMode});
}
const config={samples:5,requests:quick?1024:10000,warmup:quick?256:5000,workers:[1,2,4,6],seedPrefix:'dicecore-backend/v3.7.1/',algorithm:'mt19937',freezeResults:'never',cache:'warm',wallBudgetMs:300000};
const raw={schemaVersion:1,status:'running',mode,startedAt:new Date(started).toISOString(),configuration:config,runtimes,workloads,runs:[]};
const persist=()=>writeFileSync(rawPath,JSON.stringify(raw,null,2)+'\n');
persist();
function command(executable,argv,options={}) {
  const remaining=deadline-Date.now();
  if(remaining<=0) throw new Error('Backend benchmark exceeded five-minute budget');
  const result=spawnSync(executable,argv,{cwd:root,encoding:'utf8',timeout:remaining,maxBuffer:128*1024*1024,windowsHide:true,...options});
  if(result.error||result.status!==0) throw new Error(`${executable} ${argv.join(' ')} failed: ${result.error?.message??[result.stderr,result.stdout].filter(Boolean).join('\n')}`);
  return result.stdout.trim();
}
function snapshot() {
  const files=[];
  const collect=(dir,include)=>{for(const entry of readdirSync(path.join(root,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file,include);else if(include(file))files.push(file);}};
  collect('src',file=>file.endsWith('.ts')&&!file.endsWith('.test.ts'));
  collect('dist',file=>file.endsWith('.js'));
  for(const name of readdirSync(path.join(root,'go')))if(name.endsWith('.go')&&!name.endsWith('_test.go'))files.push(path.join('go',name));
  files.push('go/backend_benchmark_test.go','go/backend_rss_windows_test.go','go/backend_rss_linux_test.go','go/backend_rss_other_test.go','scripts/benchmark-backend-reference.mjs','scripts/compare-backend-runtimes.mjs','package.json','package-lock.json','go/go.mod','rollup.config.mjs','tsconfig.json','tsconfig.build.json');
  const manifest=files.sort().map(file=>({path:file.replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex')}));
  return {sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),files:manifest};
}
function worker(runtime,workers,phase) {
  const request={...config,phase,workers,engineMode:runtime==='go-shared'?'shared':'pool',workloads,
    validationIndices:[0,1,2,3,4,5,127,255,1023,4095,8191,config.requests-1].filter((value,index,array)=>value<config.requests&&array.indexOf(value)===index)};
  const wallStarted=Date.now();
  const output=runtime.startsWith('go-')
    ? command(binary,['-test.run=^TestBackendBenchmarkWorker$'],{cwd:path.join(root,'go'),env:{...process.env,DICECORE_BACKEND_WORKER:'1'},input:JSON.stringify(request)})
    : command(runtime==='bun'?bun:process.execPath,[path.join(root,'scripts/benchmark-backend-reference.mjs')],{input:JSON.stringify(request)});
  const line=output.split(/\r?\n/).find(line=>line.startsWith('DICECORE_BACKEND '));
  if(!line) throw new Error(`Missing worker output: ${output.slice(0,500)}`);
  return {runtime,workers,wallMilliseconds:Date.now()-wallStarted,output:JSON.parse(line.slice('DICECORE_BACKEND '.length))};
}
function quantile(values,q){const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*q,lo=Math.floor(at);return sorted[lo]+(sorted[Math.ceil(at)]-sorted[lo])*(at-lo);}
function stats(measurements,memory){const values=measurements.map(value=>value.durationNs),median=quantile(values,.5),rss=memory.afterBatches.filter(value=>value.available).map(value=>value.rssBytes/2**20);return {medianBatchMs:median/1e6,q1BatchMs:quantile(values,.25)/1e6,q3BatchMs:quantile(values,.75)/1e6,minimumBatchMs:Math.min(...values)/1e6,maximumBatchMs:Math.max(...values)/1e6,opsPerSecond:config.requests*1e9/median,amortizedNsPerOp:median/config.requests,samples:values,afterWarmupRssMiB:memory.afterWarmup.available?memory.afterWarmup.rssBytes/2**20:null,medianSnapshotRssMiB:rss.length?quantile(rss,.5):null,maximumSnapshotRssMiB:rss.length?Math.max(...rss):null,q1SnapshotRssMiB:rss.length?quantile(rss,.25):null,q3SnapshotRssMiB:rss.length?quantile(rss,.75):null};}
function report(data){
  const nf=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(value);
  const dec=value=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  const cells=row=>runtimes.map(runtime=>{const s=row[runtime];return `${nf(s.opsPerSecond)} / ${dec(s.medianBatchMs)} [${dec(s.q1BatchMs)}–${dec(s.q3BatchMs)}]`;}).join(' | ');
  const rows=data.summary.map(row=>`| ${row.label} | ${row.workers} | ${cells(row)} |`).join('\n');
  const maybeMiB=value=>value===null?'indisponível':dec(value);
  const rssRows=data.summary.map(row=>`| ${row.label} | ${row.workers} | ${runtimes.map(runtime=>`${maybeMiB(row[runtime].afterWarmupRssMiB)} / ${maybeMiB(row[runtime].medianSnapshotRssMiB)} / ${maybeMiB(row[runtime].maximumSnapshotRssMiB)}`).join(' | ')} |`).join('\n');
  return `# Lotes e concorrência: Go, Node e Bun\n\nMedição de chamadas locais da biblioteca com seeds únicas, sem HTTP, sockets ou Discord. Cada lote conclui ${nf(config.requests)} rolagens; todos os runtimes recebem as mesmas expressões, modos, índices e seeds. Este experimento complementa as [17 cargas históricas](BENCHMARK.md), que continuam publicadas integralmente. Não havia medição concorrente ou Bun no [baseline original](benchmarks/baseline/README.md).\n\n`+
  `## Ambiente\n\n${data.environment.cpuModel.trim()} · ${data.environment.osVersion} · ${data.environment.arch} · ${data.environment.logicalCPUs} CPUs lógicas. Node ${data.environment.node}; Bun ${data.environment.bun}; ${data.environment.go}. Commit-base \`${data.git.commit}\`, com ${data.git.statusLines.length} entradas alteradas/não rastreadas. Manifesto estável: \`${data.source.sha256}\`. Execução concluída em ${data.finishedAt}, com ${dec(data.wallMilliseconds/1000)} s de duração total.\n\n`+
  `## Método e equivalência\n\nSão ${config.samples} lotes por carga/configuração, com ${config.workers.join('/')} workers. Cada configuração mantém o processo, as engines e os workers durante os lotes; cada carga aquece ${nf(config.warmup)} chamadas por worker uma vez antes dos lotes. Processos, imports, criação de engines, seeds e aquecimento ficam fora do cronômetro. A ordem dos runtimes alterna entre configurações de workers; runtimes distintos não medem simultaneamente.\n\n`+
  `O timer mede o tempo real do início da liberação/envio do lote até a confirmação de conclusão de todos os workers. Inclui despacho e retorno dos contadores agregados. Cada chamada constrói o resultado do modo escolhido; serialização JSON e transferência de cada resultado completo para outro processo não são medidas. Node/Bun usam worker_threads com uma engine por isolate. Go usa goroutines e preserva o GOMAXPROCS padrão/configurado, registrado nos dados brutos; \`go-pool\` usa uma engine por worker e \`go-shared\` compartilha uma engine, incluindo eventual contenção do cache. Não há restrição de afinidade ou quota de CPU em nenhum runtime.\n\n`+
  `MT19937, limites padrão, cache aquecido e freezeResults='never' em todos. A seed de índice i é \`${config.seedPrefix}\` + i; são ${nf(config.requests)} seeds distintas por lote. O conjunto é repetido nos lotes para comparabilidade. Warmup não é contado como trabalho entregue. Os índices são divididos em passos do número de workers, sem perder ou duplicar chamadas.\n\n`+
  `O preflight comparou JSON completo de ${data.preflight.uniqueOutputs} resultados por configuração e passou nos quatro modos de runtime e em todos os números de workers. Cada lote medido também confirmou contagem, soma dos totais, soma ponderada pelo índice e chamadas aleatórias, iguais entre runtimes e configurações. Esses contadores detectam divergências de entrega, mas não substituem a suíte de conformidade nem constituem hash criptográfico dos resultados.\n\n`+
  `## Resultados\n\nCada célula mostra **operações/s / mediana do lote em ms [Q1–Q3]**. Maior throughput e menor duração indicam melhor desempenho. Os quartis são entre lotes; não representam p95 de requisições individuais. Tempo amortizado por chamada está no JSON, sem interpretá-lo como latência de uma chamada concorrente.\n\n| Carga | Workers | Node | Bun | Go pool | Go compartilhada |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\n`+
  `## Gráficos\n\n![Throughput por número de workers e modo](benchmarks/backend-throughput.png)\n\n![Tempo real dos lotes por número de workers](benchmarks/backend-batches.png)\n\n[Throughput SVG](benchmarks/backend-throughput.svg) · [Duração SVG](benchmarks/backend-batches.svg).\n\n`+
  `## Memória residente do processo\n\nSnapshots RSS, em MiB: **após aquecimento / mediana após lotes / maior snapshot após lotes**. Node/Bun usam process.memoryUsage().rss; Go Windows usa GetProcessMemoryInfo.WorkingSetSize (Linux: /proc/self/statm). Incluem runtime, workers, caches e estruturas compactas de seeds/options pré-criadas pelo harness. São valores absolutos, sem subtrair o snapshot inicial. As leituras acontecem fora do timer, com GC natural. O maior snapshot observado não é o pico real do processo; transientes entre leituras e pico de startup não foram amostrados. Não se comparam heaps JS/Go nem B/op entre linguagens.\n\n| Carga | Workers | Node | Bun | Go pool | Go compartilhada |\n|---|---:|---:|---:|---:|---:|\n${rssRows}\n\n![RSS após lotes](benchmarks/backend-rss.png)\n\n[RSS em SVG](benchmarks/backend-rss.svg).\n\n`+
  `## Reprodução e dados\n\n\`\`\`powershell\nnode scripts/compare-backend-runtimes.mjs --go '${go.replaceAll("'","''")}' --bun '${bun.replaceAll("'","''")}'\npython scripts/plot-backend-benchmark.py\n\`\`\`\n\nRequer Node, Bun, Go e dependências npm instaladas; gráficos usam matplotlib==3.10.8. \`--quick\` usa 1.024 chamadas, cinco lotes e warmup reduzido. \`--preflight-only\` só compara resultados. Modos de desenvolvimento gravam em .artifacts/benchmark-calibration. Limite rígido de cinco minutos por execução.\n\n[Medições e manifesto](benchmarks/backend-final.json) · [Preflight integral](benchmarks/backend-preflight-final.json) · [Orquestrador](../scripts/compare-backend-runtimes.mjs).\n\n## Limitações\n\nMicrobenchmark em Windows compartilhado com ferramentas de desenvolvimento. GC natural, JIT, escalonamento e frequência da CPU influenciam os números. Engines isoladas e uma engine compartilhada representam arquiteturas diferentes, explicitadas nas colunas. Não há comparação de alocações entre linguagens, rede, latência de ponta a ponta de servidor nem mistura de clientes reais. Escalar workers aumenta paralelismo, mas não garante ganho linear.\n`;
}
try {
  raw.environment={cpuModel:os.cpus()[0].model,logicalCPUs:os.cpus().length,osVersion:os.version(),osRelease:os.release(),arch:process.arch,totalMemoryBytes:os.totalmem(),node:process.version,bun:command(bun,['--version']),go:command(go,['version']),runtimeEnvironment:Object.fromEntries(['NODE_OPTIONS','GOMAXPROCS','GOGC','GOMEMLIMIT'].map(key=>[key,process.env[key]??null]))};
  raw.git={commit:command('git',['rev-parse','HEAD']),statusLines:command('git',['status','--porcelain=v1']).split(/\r?\n/).filter(Boolean)};
  raw.commands=[{executable:process.execPath,args:['node_modules/rollup/dist/bin/rollup','--config=./rollup.config.mjs']},{executable:go,args:['test','-c','-o',binary],cwd:'go'}];
  persist();
  console.log('Building Node/Bun bundle and Go backend worker outside measured batches.');
  command(process.execPath,raw.commands[0].args);
  command(go,raw.commands[1].args,{cwd:path.join(root,'go')});
  raw.source=snapshot();raw.goWorkerBinary={sha256:createHash('sha256').update(readFileSync(binary)).digest('hex')};
  const preflight={runs:[]};let expected;
  for(const workers of config.workers) for(const runtime of runtimes){const run=worker(runtime,workers,'preflight');preflight.runs.push(run);writeFileSync(preflightPath,JSON.stringify(preflight,null,2)+'\n');if(!expected)expected=run.output.cases;else assert.deepStrictEqual(run.output.cases,expected,`Preflight ${runtime}/${workers}`);}
  raw.preflight={passed:true,uniqueOutputs:Object.values(expected).reduce((sum,values)=>sum+values.length,0),configurations:config.workers.length*runtimes.length,file:path.relative(root,preflightPath).replaceAll('\\','/')};persist();
  console.log(`Preflight passed for ${raw.preflight.configurations} worker configurations.`);
  if(!preflightOnly){
    const digests={};
    for(let index=0;index<config.workers.length;index++){
      const workers=config.workers[index],order=[...runtimes.slice(index),...runtimes.slice(0,index)];
      for(const runtime of order){console.log(`Measuring ${runtime}, workers=${workers}, ${config.samples} batches per workload`);const run=worker(runtime,workers,'measure');raw.runs.push(run);persist();for(const [id,measurements] of Object.entries(run.output.cases)){assert.equal(measurements.length,config.samples);for(const measured of measurements){assert.equal(measured.digest.count,config.requests);assert.ok(measured.durationNs>0);if(!digests[id])digests[id]=measured.digest;else assert.deepStrictEqual(measured.digest,digests[id],`Batch delivery ${id}/${runtime}/${workers}`);}}}
    }
    raw.summary=workloads.flatMap(workload=>config.workers.map(workers=>({id:workload.id,label:workload.label,mode:workload.mode,workers,...Object.fromEntries(runtimes.map(runtime=>{const run=raw.runs.find(run=>run.runtime===runtime&&run.workers===workers);return [runtime,stats(run.output.cases[workload.id],run.output.memory[workload.id])];}))})));
  }
  assert.equal(snapshot().sha256,raw.source.sha256,'Source changed while benchmarking');
  raw.status='complete';raw.finishedAt=new Date().toISOString();raw.wallMilliseconds=Date.now()-started;persist();
  if(!quick&&!preflightOnly)writeFileSync(path.join(root,'go/BACKEND_BENCHMARK.md'),report(raw));
  console.log(`Saved ${path.relative(root,rawPath)} in ${Math.round(raw.wallMilliseconds/1000)} seconds.`);
}catch(error){raw.status='failed';raw.error={message:error.message,stack:error.stack};raw.finishedAt=new Date().toISOString();raw.wallMilliseconds=Date.now()-started;persist();console.error(error.stack);process.exitCode=1;}
