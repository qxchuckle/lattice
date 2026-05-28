export { parseSpec, writeSpec, writeSpecRaw, deleteSpec, specExists } from './io';
export { getGlobalSpecs, getUserSpecs, getProjectSpecs, getCascadedSpecs } from './cascade';
export { detectSpecConflicts } from './conflicts';
export { findSpecByName } from './query';
export type { SpecMatch, FindSpecOptions } from './query';
export { validateSpecScope, validateSpecsScope } from './validate';
export type { SpecValidationWarning } from './validate';
