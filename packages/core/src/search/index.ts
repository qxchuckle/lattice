export {
  getContextForProject,
  getSmartContext,
  formatContextAsMarkdown,
  resolveSpecScope,
  type ContextOptions,
} from './context';

export { hybridSearch } from './search';
export { searchProjects, projectSearchResultsToSearchResults } from './project-search';
export { unifiedSearch } from './unified-search';
export { computeDynamicLimits, type DynamicLimits } from './dynamic-limits';
export type { ProjectMatchProvenance, ProjectSearchResult } from './project-search';
