/**
 * Reproducible comparison of shipped TypeScript and native Go APIs.
 * No implementation variants or optimizations are introduced by this harness.
 * node scripts/compare-go-typescript.mjs --go <go executable> [--quick|--preflight-only]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let go = process.env.GO_BINARY ?? 'go';
let quick = false;
let preflightOnly = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--go' && args[index + 1]) go = args[++index];
  else if (args[index] === '--quick') quick = true;
  else if (args[index] === '--preflight-only') preflightOnly = true;
  else throw new Error(`Unknown argument: ${args[index]}`);
}

const start = Date.now();
const deadline = start + 10 * 60_000;
const directory = quick || preflightOnly
  ? path.join(root, '.artifacts', 'benchmark-calibration')
  : path.join(root, 'go', 'benchmarks');
const artifacts = path.join(root, '.artifacts');
mkdirSync(directory, { recursive: true });
mkdirSync(artifacts, { recursive: true });
const tag = preflightOnly ? 'preflight' : quick ? 'quick' : 'final';
const rawPath = path.join(directory, `comparison-${tag}.json`);
const preflightPath = path.join(directory, `preflight-${tag}.json`);
const binary = path.join(artifacts, `dicecore-comparison${process.platform === 'win32' ? '.exe' : ''}`);
const raw = {
  schemaVersion: 1,
  status: 'running',
  mode: tag,
  startedAt: new Date(start).toISOString(),
  commands: [],
  samples: [],
};
const persist = () => writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
persist();

function command(executable, argv, options = {}) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Benchmark exceeded the ten-minute wall-clock budget');
  const result = spawnSync(executable, argv, {
    cwd: root, encoding: 'utf8', timeout: remaining, maxBuffer: 64 * 1024 * 1024,
    windowsHide: true, ...options,
  });
  if (result.error || result.status !== 0) {
    const diagnostic = result.error?.message ?? [result.stderr, result.stdout].filter(Boolean).join('\n');
    throw new Error(`${executable} ${argv.join(' ')} failed: ${diagnostic}`);
  }
  return result.stdout.trim();
}

function sourceSnapshot() {
  const files = [];
  const collect = (directory, include) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(relative, include);
      else if (include(relative)) files.push(relative);
    }
  };
  collect('src', file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  collect('dist', file => file.endsWith('.js'));
  for (const entry of readdirSync(path.join(root, 'go'))) {
    if (entry.endsWith('.go') && !entry.endsWith('_test.go')) files.push(path.join('go', entry));
  }
  files.push('package.json', 'package-lock.json', 'rollup.config.mjs', 'tsconfig.json', 'tsconfig.build.json',
    'go/go.mod', 'go/benchmark_test.go', 'scripts/benchmark-go-reference.mjs', 'scripts/compare-go-typescript.mjs');
  const manifest = files.sort().map(file => ({
    path: file.replaceAll('\\', '/'),
    sha256: createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'),
  }));
  return { sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), files: manifest };
}

const fixedSeed = ['dicecore-comparison/v3.7.1'];
const changingSeeds = Array.from({ length: 16 }, (_, index) => `dicecore-comparison/v3.7.1/${index}`);
const normalizationInputs = [' d + 2d + f ', '2#4d6kh3+1d8 [ataque]', '1d20+2-pool(1)adv', '2 D 6 [ação 🎲] // descrição'];
const workloads = [];
function add(id, label, kind, input, mode = '', options = {}) {
  workloads.push({ id, label, kind, input, mode, cache: true, algorithm: 'mt19937',
    seeds: fixedSeed, validationCount: 1, ...options });
}
add('normalize', 'Normalização — ciclo de quatro entradas', 'normalize', null, '', { inputs: normalizationInputs, validationCount: normalizationInputs.length });
add('compile-cold', 'Compilar fórmula, cache desativado', 'compile', '2#4d6kh3+1d8', '', { cache: false });
add('compile-hot', 'Compilar fórmula, cache aquecido', 'compile', '2#4d6kh3+1d8');
for (const mode of ['full', 'details', 'summary']) {
  add(`d20-${mode}`, `1d20+5 — ${mode}`, 'roll', '1d20+5', mode);
  add(`100d6-${mode}`, `100d6 — ${mode}`, 'roll', '100d6', mode);
}
add('pool-full', 'Pool com explosão limitada — full', 'roll', '20d6!2ro=1kh10', 'full');
add('pool-summary', 'Pool com explosão limitada — summary', 'roll', '20d6!2ro=1kh10', 'summary');
for (const mode of ['full', 'compact']) {
  add(`fate-${mode}`, `Fate, 20 dados — ${mode}`, 'fate', { dice: 20 }, mode);
  add(`v5-${mode}`, `V5, pool 10/fome 3 — ${mode}`, 'vampire-v5', { pool: 10, hunger: 3, difficulty: 4 }, mode);
}
add('mixed-compact', 'Misto, todos os sistemas — compact', 'mixed', '2d20kh1; fate(4); v5(7,3,4); assim(d6=2,d10=1,d12=1,keep=1); dh(2,15)', 'compact');
add('d20-changing-seed', '1d20+5 — summary, 16 seeds alternadas', 'roll', '1d20+5', 'summary', { seeds: changingSeeds, validationCount: changingSeeds.length });

function worker(runtime, request) {
  const started = Date.now();
  const output = runtime === 'go'
    ? command(binary, ['-test.run=^TestBenchmarkWorker$'], {
      cwd: path.join(root, 'go'), env: { ...process.env, DICECORE_COMPARISON_WORKER: '1' }, input: JSON.stringify(request),
    })
    : command(process.execPath, [path.join(root, 'scripts', 'benchmark-go-reference.mjs')], { input: JSON.stringify(request) });
  const line = output.split(/\r?\n/).find(line => line.startsWith('DICECORE_BENCHMARK '));
  if (!line) throw new Error(`No JSON result from ${runtime}: ${output.slice(0,500)}`);
  return { workerWallMilliseconds: Date.now() - started, output: JSON.parse(line.slice('DICECORE_BENCHMARK '.length)) };
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const location = (sorted.length - 1) * q;
  const lower = Math.floor(location);
  return sorted[lower] + (sorted[Math.ceil(location)] - sorted[lower]) * (location - lower);
}
function summary(values) {
  const median = quantile(values, 0.5);
  return { medianNsPerOp: median, medianMsPerOp: median / 1e6, opsPerSecond: 1e9 / median,
    q1NsPerOp: quantile(values, 0.25), q3NsPerOp: quantile(values, 0.75),
    minimumNsPerOp: Math.min(...values), maximumNsPerOp: Math.max(...values), samples: values };
}

function markdown(result) {
  const nf = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
  const decimal = value => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const range = stats => `${nf(stats.medianNsPerOp)} [${nf(stats.q1NsPerOp)}–${nf(stats.q3NsPerOp)}]`;
  const rows = result.summary.map(row => `| ${row.label} | ${range(row.typescript)} | ${range(row.go)} | ${nf(row.typescript.opsPerSecond)} | ${nf(row.go.opsPerSecond)} | ${decimal(row.typescriptOverGo)}× |`).join('\n');
  const faster = result.summary.filter(row => row.typescriptOverGo > 1).length;
  const inputs = workloads.map(workload => `| ${workload.id} | ${workload.kind} | ${workload.kind === 'normalize' ? 'Ciclo de quatro entradas no JSON' : `\`${typeof workload.input === 'string' ? workload.input : JSON.stringify(workload.input)}\``} | ${workload.mode || '—'} | ${workload.kind === 'normalize' ? '—' : workload.cache ? 'aquecido' : 'desativado'} |`).join('\n');
  return `# Benchmark: biblioteca Go × TypeScript\n\nExecução em ${result.finishedAt}. Comparação de APIs locais da biblioteca v3.7.1, sem HTTP ou Discord. Em ${faster} de ${workloads.length} cargas, a mediana de Go foi menor. Isso descreve estas cargas e esta máquina; não é uma estimativa de ganho do Fortuna em produção.\n\n` +
    `## Ambiente e versão\n\n- CPU: ${result.environment.cpuModel}; ${result.environment.logicalCPUs} processadores lógicos.\n- Sistema: ${result.environment.osVersion}; ${result.environment.arch}.\n- Memória instalada: ${decimal(result.environment.totalMemoryBytes / 2 ** 30)} GiB.\n- Runtimes: TypeScript compilado executado no Node ${result.environment.node}; ${result.environment.go}.\n- Commit-base: \`${result.git.commit}\`. A árvore continha ${result.git.statusLines.length} entradas alteradas/não rastreadas; o manifesto SHA-256 dos arquivos medidos está nos dados brutos.\n- SHA-256 conjunto: \`${result.source.sha256}\`. Conferido novamente ao terminar, sem alteração.\n- Variáveis de runtime: \`${JSON.stringify(result.environment.runtimeEnvironment)}\`.\n\n` +
    `## Método\n\nO harness compilou o executável Go de teste e o bundle TypeScript antes das medições. O preflight comparou o JSON completo de ${result.preflight.validatedOutputs} resultados entre os runtimes e passou para todas as cargas. Compilação, inicialização de processo, carregamento de módulos, preparação de engines e serialização do resultado ficaram fora dos cronômetros.\n\n` +
    `Foram ${result.configuration.samples} rodadas, produzindo uma amostra por runtime/carga em cada rodada. Cada runtime inicia um processo novo por rodada e percorre todas as cargas; cada carga tem aquecimento explícito seguido de um lote medido. O tamanho do lote é igual para Go e TypeScript na mesma carga, calibrado para aproximadamente ${result.configuration.targetBatchMs} ms no runtime mais rápido, limitado a ${nf(result.configuration.maximumIterations)} operações. O aquecimento executa no mínimo ${result.configuration.warmupFloor} e no máximo ${nf(result.configuration.warmupCap)} chamadas, conforme o tamanho do lote.\n\n` +
    `Go e TypeScript nunca rodam simultaneamente neste harness. A ordem entre runtimes e a ordem das cargas alternam entre rodadas. Coleta de lixo fica no funcionamento natural de cada runtime; não há GC forçada. O limite global de execução é dez minutos. Nenhuma implementação foi otimizada durante este experimento.\n\n` +
    `As expressões, modos de resultado, limites padrão, algoritmo MT19937, políticas de cache e seeds são iguais. Ambas as engines usam \`freezeResults: 'never'\`, excluindo o congelamento recursivo opcional dos resultados. A maioria das cargas usa uma seed fixa; a última alterna 16 seeds. Essa distinção importa: o TypeScript mantém um pequeno cache da inicialização MT para a última seed. Rolagens sem seed, custo de obtenção de entropia e cargas paralelas não foram medidos.\n\n` +
    `## Resultados\n\nMediana e intervalo interquartil Q1–Q3 dos tempos médios de lote, em **ns/op**. A razão **TS/Go** maior que 1 favorece Go; menor que 1 favorece TypeScript. Ops/s é o inverso da mediana.\n\n` +
    `| Carga | TS mediana [Q1–Q3], ns/op | Go mediana [Q1–Q3], ns/op | TS ops/s | Go ops/s | TS/Go |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `Q1–Q3 mostra dispersão entre lotes, não intervalo de confiança. Os lotes não medem latência individual de requisição; não há p95 de requisições nesta tabela. As amostras, durações, warmups e quantidades exatas por carga estão no JSON original.\n\n` +
    `## Gráficos\n\n![Tempo médio por operação: medianas e intervalo interquartil de Go e TypeScript](benchmarks/latency.png)\n\n![Razão TS/Go por carga: valores acima de 1 favorecem Go](benchmarks/speedup.png)\n\nVersões vetoriais para exportar: [tempos por operação](benchmarks/latency.svg) e [razões TS/Go](benchmarks/speedup.svg). Os gráficos usam os mesmos dados da tabela.\n\n` +
    `## Cargas\n\n| ID | Operação | Entrada | Modo | Cache |\n|---|---|---|---|---|\n${inputs}\n\n` +
    `Cada operação de normalização processa uma única entrada; os lotes percorrem as quatro entradas em ciclo. No caso de compilação sem cache, a engine é criada antes de cronometrar e cada operação refaz o trabalho de análise/compilação. No caso aquecido, cada operação chama a API pública de compilação; Go também entrega a cópia de plano exigida por seu contrato de propriedade. Rolagens usam entradas textuais com cache aquecido, não um atalho interno de executor.\n\n` +
    `## Reprodução e dados originais\n\nA partir da raiz do repositório, com Node 24.18.0, Go 1.26.2 e as dependências npm instaladas:\n\n\`\`\`powershell\nnode scripts/compare-go-typescript.mjs --go '${go.replaceAll("'", "''")}'\n\`\`\`\n\nPara verificar o harness rapidamente, acrescente \`--quick\`; esse modo grava dados separados e não substitui este relatório. \`--preflight-only\` executa somente a verificação de resultados, após os builds.\n\n` +
    `- [Medições, metadados e manifesto](benchmarks/comparison-final.json).\n- [JSON integral dos resultados usados no preflight](benchmarks/preflight-final.json).\n- [Orquestrador](../scripts/compare-go-typescript.mjs), [worker TypeScript](../scripts/benchmark-go-reference.mjs) e [worker Go](benchmark_test.go).\n\nOs modos de desenvolvimento gravam seus dados em \`.artifacts/benchmark-calibration/\`, preservando as medições finais.\n\n` +
    `Para regenerar os gráficos sem repetir as medições, use Python com \`matplotlib\` instalado:\n\n\`\`\`powershell\npython scripts/plot-go-benchmark.py\n\`\`\`\n\nO [script dos gráficos](../scripts/plot-go-benchmark.py) lê os dados finais preservados no repositório.\n\n` +
    `## Limitações\n\nÉ um microbenchmark de biblioteca em uma máquina Windows compartilhada com aplicações de desenvolvimento. JIT, GC, frequência da CPU e processos externos podem influenciar as amostras. O experimento mede as implementações atuais, incluindo seus custos de validação, alocação e propriedade de dados; não isola o efeito da linguagem. Comparações próximas de 1× exigem atenção à dispersão e nova repetição em ambiente controlado.\n\nNão há medição comparável de memória: Go B/op e crescimento de heap JavaScript têm definições diferentes, e nenhum deles foi tratado como equivalência. O preflight demonstra igualdade destas cargas; a conformidade completa pertence à suíte de testes da migração.\n`;
}

try {
  raw.workloads = workloads;
  raw.environment = { cpuModel: os.cpus()[0]?.model ?? 'unknown', logicalCPUs: os.cpus().length,
    osVersion: os.version(), osRelease: os.release(), arch: process.arch,
    totalMemoryBytes: os.totalmem(), freeMemoryBytesAtStart: os.freemem(), node: process.version,
    go: command(go, ['version']), runtimeEnvironment: Object.fromEntries(
      ['NODE_OPTIONS','GOMAXPROCS','GOGC','GOMEMLIMIT'].map(key => [key, process.env[key] ?? null])), };
  raw.git = { commit: command('git', ['rev-parse', 'HEAD']),
    statusLines: command('git', ['status', '--porcelain=v1']).split(/\r?\n/).filter(Boolean) };
  raw.configuration = { samples: quick ? 3 : 7, targetBatchMs: quick ? 10 : 50, freezeResults: 'never',
    warmupFloor: quick ? 256 : 5000, warmupCap: 20000, maximumIterations: 500000, wallBudgetMs: 600000 };
  persist();
  console.log('Building TypeScript bundle and isolated Go worker (outside measured regions).');
  raw.commands.push({ executable: process.execPath, args: ['node_modules/rollup/dist/bin/rollup','--config=./rollup.config.mjs'] });
  command(process.execPath, ['node_modules/rollup/dist/bin/rollup','--config=./rollup.config.mjs']);
  raw.commands.push({ executable: go, args: ['test','-c','-o',binary], cwd: 'go' });
  command(go, ['test','-c','-o',binary], { cwd: path.join(root,'go') });
  raw.source = sourceSnapshot();
  raw.goWorkerBinary = { path: path.relative(root, binary).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(readFileSync(binary)).digest('hex') };
  const request = { phase:'preflight', workloads };
  const preflight = { typescript:worker('typescript',request), go:worker('go',request) };
  writeFileSync(preflightPath,`${JSON.stringify(preflight,null,2)}\n`);
  for (const workload of workloads) {
    assert.deepStrictEqual(preflight.go.output.cases[workload.id],preflight.typescript.output.cases[workload.id],`JSON preflight differs for ${workload.id}`);
  }
  raw.preflight = { passed:true, validatedOutputs:workloads.reduce((sum,workload)=>sum+workload.validationCount,0), file:path.relative(root,preflightPath).replaceAll('\\','/') };
  persist();
  console.log(`Preflight passed: ${raw.preflight.validatedOutputs} outputs across ${workloads.length} workloads.`);
  if (!preflightOnly) {
    const common = { phase:'measure',workloads,warmupFloor:raw.configuration.warmupFloor,warmupCap:raw.configuration.warmupCap };
    const calibrationRequest={...common,iterations:Object.fromEntries(workloads.map(workload=>[workload.id,256]))};
    raw.calibration={typescript:worker('typescript',calibrationRequest),go:worker('go',calibrationRequest)};
    const iterations=Object.fromEntries(workloads.map(workload=>{
      const fastest=Math.min(raw.calibration.typescript.output.cases[workload.id].nsPerOp,raw.calibration.go.output.cases[workload.id].nsPerOp);
      return [workload.id,Math.max(50,Math.min(raw.configuration.maximumIterations,Math.ceil(raw.configuration.targetBatchMs*1e6/fastest)))];
    }));
    raw.iterations=iterations;persist();
    for(let index=0;index<raw.configuration.samples;index++){
      const runtimeOrder=index%2===0?['typescript','go']:['go','typescript'];
      const orderedWorkloads=index%2===0?workloads:[...workloads].reverse();
      for(const runtime of runtimeOrder){
        console.log(`Sample ${index+1}/${raw.configuration.samples}: ${runtime}`);
        raw.samples.push({sample:index+1,runtime,workloadOrder:orderedWorkloads.map(workload=>workload.id),...worker(runtime,{...common,workloads:orderedWorkloads,iterations})});
        persist();
      }
    }
    raw.summary=workloads.map(workload=>{
      const ts=summary(raw.samples.filter(sample=>sample.runtime==='typescript').map(sample=>sample.output.cases[workload.id].nsPerOp));
      const native=summary(raw.samples.filter(sample=>sample.runtime==='go').map(sample=>sample.output.cases[workload.id].nsPerOp));
      return {id:workload.id,label:workload.label,typescript:ts,go:native,typescriptOverGo:ts.medianNsPerOp/native.medianNsPerOp};
    });
  }
  if(sourceSnapshot().sha256!==raw.source.sha256)throw new Error('Source or bundle changed during the benchmark; measurements are not a stable final comparison');
  raw.status='complete';raw.finishedAt=new Date().toISOString();raw.wallMilliseconds=Date.now()-start;persist();
  if(!quick&&!preflightOnly)writeFileSync(path.join(root,'go','BENCHMARK.md'),markdown(raw));
  console.log(`Saved ${path.relative(root,rawPath)} (${Math.round(raw.wallMilliseconds/1000)} seconds).`);
} catch(error) {
  raw.status='failed';raw.error={message:error.message,stack:error.stack};raw.finishedAt=new Date().toISOString();raw.wallMilliseconds=Date.now()-start;persist();
  console.error(error.stack);process.exitCode=1;
}
