export {
  LATTICE_BEGIN_MARKER,
  LATTICE_END_MARKER,
  getAIToolConfigs,
  resolveToolPath,
  splitFrontmatter,
  injectLatticeBlock,
  stripLatticeBlock,
  deployCommandsAsSkills,
  injectToToolRoot,
  listBundledAgentFiles,
  listBundledCommandSkillNames,
  type AIToolConfig,
  type ExtraRulesInjection,
  type InjectedPath,
} from './footprint';

export {
  scanInjections,
  executeUninjectPlan,
  type InjectionFinding,
  type UninjectPlan,
  type UninjectResult,
  type UninjectKind,
  type UninjectAction,
  type ScanInjectionsOptions,
} from './uninject';
