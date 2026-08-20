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
} from './domain-config';
export type { ParsedRoutes } from './domain-config';

export {
  deriveContractId,
  encodeContractDirName,
  decodeContractDirName,
  computeContribution,
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

export {
  summarizeMirror,
  peekDomain,
  joinDomain,
  unlinkDomain,
  listDomains,
  syncDomains,
} from './sync';
export type { DomainSummary, JoinResult, DomainInfo, DomainSyncOutcome } from './sync';
