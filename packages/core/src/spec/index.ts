export {
  parseSpec,
  parseFrontmatter,
  writeSpec,
  writeSpecRaw,
  deleteSpec,
  specExists,
  normalizeSpecFrontmatter,
  formatSpecParseError,
} from './io';
export {
  getGlobalSpecs,
  getUserSpecs,
  getProjectSpecs,
  getAllProjectSpecs,
  getAllProjectSpecsGrouped,
  getCascadedSpecs,
  getCascadedSpecsWithAncestors,
} from './cascade';
export type { ProjectSpecGroup } from './cascade';
export { detectSpecConflicts } from './conflicts';
export { findSpecByName, findSpecById } from './query';
export type { SpecMatch, SpecByIdMatch, FindSpecOptions } from './query';
export { validateSpecScope, validateSpecsScope } from './validate';
export type { SpecValidationWarning } from './validate';
export { generateSpecId, isValidSpecId, SPEC_ID_PREFIX, SPEC_ID_PATTERN } from './id';
export {
  lintSpecFrontmatter,
  lintSpecs,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from './lint';
export type { SpecLintIssue, SpecLintReport } from './lint';
export { migrateSpecs } from './migrate';
export type { MigrateResult, MigrateOptions, MigrateSpecRef, MigrateSpecLevel } from './migrate';
