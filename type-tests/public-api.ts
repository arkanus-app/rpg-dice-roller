import {
  DEFAULT_DICE_LIMITS,
  DiceRollError,
  compileRpgDice,
  createDiceEngine,
  inspectRpgDiceNotation,
  isDiceRollError,
  isDiceRollErrorData,
  normalizeRpgDiceNotation,
  rollRpgDice,
  rollRpgDiceSummary,
  verifyRpgDiceNotation,
} from '../src/index.js';
import type {
  ClassifyDiceEvent,
  CompileOptions,
  DiceEngine,
  DiceEngineOptions,
  DiceCacheStats,
  DiceErrorData,
  DiceEvent,
  DiceInspectionCost,
  DiceLimits,
  DiceNotationInspection,
  DiceRollErrorCode,
  DiceRollResult,
  DiceRollSummary,
  DiceSides,
  DiceState,
  ExecutionStats,
  ExcludeDiceEvent,
  ExplodeDiceEvent,
  FreezeResultsMode,
  IncludeDiceEvent,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  PoolSummary,
  ReplayDescriptor,
  RerollDiceEvent,
  ResolvedDie,
  ResolvedGroup,
  ResolvedRoll,
  RollDiceEvent,
  RollOptions,
  RollPlan,
  RollPlanGroup,
  SeedInput,
  SeedOrigin,
  SourceSpan,
} from '../src/index.js';

function expectType<T>(_value: T): void {}

export function publicApiContracts(): void {
  const span: SourceSpan = { start: 0, end: 3 };
  const jsonPrimitive: JsonPrimitive = null;
  const jsonObject: JsonObject = {
    enabled: true,
    label: 'public-api',
    nested: [1, jsonPrimitive],
  };
  const jsonValue: JsonValue = jsonObject;
  const errorCode: DiceRollErrorCode = 'INVALID_NOTATION';
  const error = new DiceRollError('Invalid notation', {
    code: errorCode,
    span,
    input: 'bad',
    details: jsonObject,
  });
  const errorData: DiceErrorData = error.toJSON();
  const unknownError: unknown = error;

  expectType<JsonValue>(jsonValue);
  expectType<DiceErrorData>(errorData);
  expectType<DiceRollError>(error);
  expectType<boolean>(isDiceRollError(unknownError));
  expectType<boolean>(isDiceRollErrorData(errorData));
  expectType<DiceRollError>(DiceRollError.fromJSON(errorData));
  if (isDiceRollError(unknownError)) {
    expectType<DiceRollError>(unknownError);
  }

  const limits: DiceLimits = DEFAULT_DICE_LIMITS;
  const compileOptions: CompileOptions = {
    limits: { maxRolls: 20 },
  };
  const freezeResults: FreezeResultsMode = 'always';
  const engineOptions: DiceEngineOptions = {
    limits: { maxGeneratedDice: 500 },
    freezeResults,
    cache: {
      maxInputEntries: 25,
      maxProgramEntries: 10,
      maxProgramNodes: 1_000,
    },
    randomAlgorithm: 'xoshiro128ss',
  };
  const engine: DiceEngine = createDiceEngine(engineOptions);

  expectType<DiceLimits>(limits);
  expectType<DiceLimits>(engine.limits);
  expectType<void>(engine.clearCache());
  expectType<DiceCacheStats>(engine.getCacheStats());
  expectType<string>(normalizeRpgDiceNotation('2d6 + 1'));
  expectType<string>(engine.normalize('2d6 + 1'));
  expectType<boolean>(verifyRpgDiceNotation('d20', compileOptions));
  expectType<boolean>(engine.verify('d20', compileOptions));

  const cost: DiceInspectionCost = {
    staticDice: 1,
    worstCaseGeneratedDice: 1,
    worstCaseRandomCalls: 1,
    totalStaticDice: 1,
    totalWorstCaseGeneratedDice: 1,
    totalWorstCaseRandomCalls: 1,
  };
  const planGroup: RollPlanGroup = {
    id: 'group-1',
    sourceNodeId: 'node-1',
    kind: 'dice',
    notation: 'd20',
    span,
    childIds: [],
  };
  const planFixture: RollPlan = {
    type: 'roll-plan',
    schemaVersion: 3,
    compilerVersion: 1,
    planFingerprint: '0123456789abcdef0123456789abcdef',
    input: 'd20',
    comment: '',
    notation: 'd20',
    normalizedNotation: 'd20',
    isMultiRoll: false,
    rollCount: 1,
    groups: [planGroup],
    cost,
  };
  const compiledPlan: RollPlan = compileRpgDice('d20', compileOptions);

  expectType<RollPlan>(planFixture);
  expectType<RollPlan>(compiledPlan);
  expectType<RollPlan>(engine.compile('d20', compileOptions));

  const seed: SeedInput = 'campaign-seed';
  const seedOrigin: SeedOrigin = 'provided-string';
  const replay: ReplayDescriptor = {
    schemaVersion: 2,
    algorithm: 'mt19937',
    algorithmVersion: 1,
    executionVersion: 1,
    mathProfile: 'decimal12-v1',
    origin: seedOrigin,
    seedMaterial: '0123456789abcdef0123456789abcdef',
    planFingerprint: planFixture.planFingerprint,
  };
  const rollOptions: RollOptions = {
    limits: { maxEvents: 100 },
    seed,
  };

  expectType<DiceRollResult>(rollRpgDice(compiledPlan, rollOptions));
  expectType<DiceRollResult>(engine.roll('d20', { replay }));
  expectType<DiceRollSummary>(rollRpgDiceSummary(compiledPlan, rollOptions));
  expectType<DiceRollSummary>(engine.rollSummary('d20', { replay }));

  const sides: DiceSides = 'F';
  const state: DiceState = 'compound';
  const rollEvent: RollDiceEvent = {
    type: 'roll',
    subject: 'die',
    sequence: 0,
    dieId: 'die-1',
    parentDieId: null,
    rollIndex: 0,
    sourceNodeId: 'node-1',
    value: 4,
  };
  const rerollEvent: RerollDiceEvent = {
    type: 'reroll',
    subject: 'die',
    sequence: 1,
    dieId: 'die-1',
    parentDieId: null,
    rollIndex: 0,
    sourceNodeId: 'node-1',
    from: 1,
    to: 4,
    reason: 'reroll',
  };
  const explodeEvent: ExplodeDiceEvent = {
    type: 'explode',
    subject: 'die',
    sequence: 2,
    dieId: 'die-1',
    parentDieId: null,
    rollIndex: 0,
    sourceNodeId: 'node-1',
    childDieId: 'die-2',
    value: 6,
    reason: 'explode',
  };
  const includeEvent: IncludeDiceEvent = {
    type: 'include',
    subject: 'die',
    sequence: 3,
    dieId: 'die-1',
    parentDieId: null,
    rollIndex: 0,
    sourceNodeId: 'node-1',
    contribution: 4,
  };
  const excludeEvent: ExcludeDiceEvent = {
    type: 'exclude',
    subject: 'die',
    sequence: 4,
    dieId: 'die-2',
    parentDieId: 'die-1',
    rollIndex: 0,
    sourceNodeId: 'node-1',
    reason: 'drop',
  };
  const classifyEvent: ClassifyDiceEvent = {
    type: 'classify',
    subject: 'die',
    sequence: 5,
    dieId: 'die-1',
    parentDieId: null,
    rollIndex: 0,
    sourceNodeId: 'node-1',
    outcome: 'success',
  };
  const events: readonly DiceEvent[] = [
    rollEvent,
    rerollEvent,
    explodeEvent,
    includeEvent,
    excludeEvent,
    classifyEvent,
  ];
  const resolvedDie: ResolvedDie = {
    id: 'die-1',
    sourceNodeId: 'node-1',
    parentDieId: null,
    rollIndex: 0,
    rollDieIndex: 0,
    groupId: 'group-1',
    sides,
    rawValue: 4,
    value: 4,
    contribution: 4,
    included: true,
    states: [state],
  };
  const resolvedGroup: ResolvedGroup = {
    id: 'group-1',
    sourceNodeId: 'node-1',
    rollIndex: 0,
    kind: 'dice',
    notation: 'd20',
    span,
    value: 4,
    contribution: 4,
    included: true,
    states: [],
    childIds: ['die-1'],
  };
  const pool: PoolSummary = {
    successes: 1,
    failures: 0,
    netSuccesses: 1,
  };
  const resolvedRoll: ResolvedRoll = {
    index: 0,
    total: 4,
    pool,
    diceRange: { start: 0, count: 1 },
    groupRange: { start: 0, count: 1 },
    eventRange: { start: 0, count: events.length },
  };
  const stats: ExecutionStats = {
    rolls: 1,
    initialDice: 1,
    generatedDice: 0,
    randomCalls: 1,
    modifierSteps: 0,
    events: events.length,
    resolvedGroups: 1,
    resultItems: 8,
  };
  const rollResult: DiceRollResult = {
    type: 'dice-roll',
    schemaVersion: 3,
    input: 'd20',
    notation: 'd20',
    normalizedNotation: 'd20',
    comment: '',
    total: 4,
    output: '[4] = 4',
    replay,
    stats,
    rolls: [resolvedRoll],
    groups: [resolvedGroup],
    dice: [resolvedDie],
    events,
    pool,
  };
  const validInspection: DiceNotationInspection = {
    type: 'dice-notation-inspection',
    input: 'd20',
    notation: 'd20',
    normalizedNotation: 'd20',
    comment: '',
    isValid: true,
    plan: planFixture,
    groups: [planGroup],
    cost,
    error: null,
  };

  expectType<RollDiceEvent>(rollEvent);
  expectType<RerollDiceEvent>(rerollEvent);
  expectType<ExplodeDiceEvent>(explodeEvent);
  expectType<IncludeDiceEvent>(includeEvent);
  expectType<ExcludeDiceEvent>(excludeEvent);
  expectType<ClassifyDiceEvent>(classifyEvent);
  expectType<ResolvedDie>(resolvedDie);
  expectType<ResolvedGroup>(resolvedGroup);
  expectType<PoolSummary>(pool);
  expectType<ResolvedRoll>(resolvedRoll);
  expectType<DiceRollResult>(rollResult);
  expectType<DiceNotationInspection>(validInspection);
  expectType<DiceNotationInspection>(inspectRpgDiceNotation('d20', compileOptions));
  expectType<DiceNotationInspection>(engine.inspect('d20', compileOptions));

  // @ts-expect-error Compile input must be RPG notation text.
  compileRpgDice(20);
  // @ts-expect-error Unknown engine options are not part of the public contract.
  createDiceEngine({ cache: true });
  // @ts-expect-error Freeze mode is a closed string union.
  createDiceEngine({ freezeResults: 'sometimes' });
  // @ts-expect-error Limit overrides must be numeric.
  createDiceEngine({ limits: { maxRolls: 'twenty' } });
  // @ts-expect-error Seeds are limited to strings and numbers.
  rollRpgDice('d20', { seed: true });
  // @ts-expect-error A roll cannot combine a new seed with a replay descriptor.
  rollRpgDice('d20', { seed: 'new', replay });
  rollRpgDice('d20', {
    // @ts-expect-error Replay version 2 is not supported by the V3 contract.
    replay: { seed: 'string:test', origin: 'provided', algorithm: 'mt19937', version: 2 },
  });
  // @ts-expect-error Default limits are exposed as readonly values.
  DEFAULT_DICE_LIMITS.maxRolls = 10;

  // @ts-expect-error Error codes are a closed string union.
  const invalidErrorCode: DiceRollErrorCode = 'UNKNOWN_ERROR';
  // @ts-expect-error Dice side names only admit the Fudge literal.
  const invalidSides: DiceSides = 'percentile';
  // @ts-expect-error Dice states are a closed string union.
  const invalidState: DiceState = 'kept';
  // @ts-expect-error Roll events require their discriminant-specific value.
  const invalidEvent: DiceEvent = {
    type: 'roll',
    subject: 'die',
    sequence: 0,
    dieId: 'die-1',
    parentDieId: null,
    rollIndex: 0,
    sourceNodeId: 'node-1',
  };

  expectType<DiceRollErrorCode>(invalidErrorCode);
  expectType<DiceSides>(invalidSides);
  expectType<DiceState>(invalidState);
  expectType<DiceEvent>(invalidEvent);
}
