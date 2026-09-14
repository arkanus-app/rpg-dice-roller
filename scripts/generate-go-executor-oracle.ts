// Keep compiler and executor in one tsx module namespace: RollPlan identity is
// deliberately local to the compiler instance that created it.
export { compileDicePlan } from '../src/v3/compiler.js';
export { executeRollPlan, executeRollPlanDetails, executeRollPlanSummary } from '../src/v3/executor.js';
export { createDiceLimits } from '../src/v3/runtime/limits.js';
