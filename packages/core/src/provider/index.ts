export type {
  SourceId,
  SpecView,
  TaskView,
  ProjectView,
  DataSource,
  DomainSourceInput,
} from './types';
export { sourceLabel } from './types';
export { createLocalSource } from './local-source';
export { createDomainSource, DegradedSourceError } from './domain-source';
export { createComposite } from './composite';
export type { MergedView, CompositeResult, ShadowedEntry } from './composite';
export { findDomainTaskHint, findDomainProjectHint, domainReadOnlyMessage } from './hints';
export type { DomainObjectHint } from './hints';
