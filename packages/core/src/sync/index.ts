export {
  DEFAULT_DOMAIN_BRANCH,
  computeDomainHash,
  domainHashOf,
  mirrorDirOf,
  normalizeDomainConfig,
  validateDomainConfig,
  validateRoute,
  parseRoutes,
  readSyncDomains,
  writeSyncDomains,
  addSyncDomain,
  removeSyncDomain,
  resolveDomainRef,
} from './domain-config';
export type { ParsedRoutes } from './domain-config';

export {
  deriveContractId,
  encodeContractDirName,
  decodeContractDirName,
  computeContribution,
  previewContribution,
  walkFiles,
} from './contribution';
export type { ContributionFile, ContributionPlan } from './contribution';

export {
  ensureMirror,
  mirrorPull,
  mirrorCommitAllAndPush,
  isRebaseInProgress,
  abortRebaseIfNeeded,
} from './mirror';
export type { MirrorResult } from './mirror';

export { readBaseline, writeBaseline, pushDomain, derivePushState } from './push';
export type { DomainBaseline, DomainPushResult, DomainPushStatus } from './push';
export { getSyncStatusDir, getSyncStatusPath } from './status';
export { appendSyncLog, readSyncLog, getSyncLogDir, getSyncLogPath } from './log';
export type { SyncLogEntry, SyncLogAction } from './log';

export {
  summarizeMirror,
  peekDomain,
  joinDomain,
  unlinkDomain,
  updateDomain,
  listDomains,
  syncDomains,
} from './sync';
export type {
  DomainSummary,
  JoinResult,
  DomainInfo,
  DomainSyncOutcome,
  DomainLastSync,
  DomainStats,
} from './sync';
