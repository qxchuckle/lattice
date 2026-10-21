export type ArtifactKind = 'spec' | 'task' | 'decision' | 'checkpoint';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  title: string;
  project: string;
  col: number;
  row: number;
  /** Lift decision nodes slightly off the lattice plane. */
  z?: number;
}

export interface ProjectRow {
  id: string;
  label: string;
  row: number;
}

export interface Relation {
  a: string;
  b: string;
  label: string;
}

export const PROJECTS: ProjectRow[] = [
  { id: 'acme-api', label: 'acme-api', row: 2 },
  { id: 'acme-portal', label: 'acme-portal', row: 4 },
  { id: 'design-system', label: 'design-system', row: 6 },
];

export const SESSIONS = [
  { col: 1, label: '10-14' },
  { col: 3, label: '10-15' },
  { col: 5, label: '10-16' },
  { col: 7, label: '10-17' },
  { col: 9, label: '10-18' },
  { col: 11, label: '10-19' },
];

export const ARTIFACTS: Artifact[] = [
  // acme-api
  {
    id: 'api-spec-envelope',
    kind: 'spec',
    label: 'spec/api-envelope',
    title: 'API envelope & error codes',
    project: 'acme-api',
    col: 1,
    row: 2,
  },
  {
    id: 'api-task-auth',
    kind: 'task',
    label: 'task/api-auth',
    title: 'Auth service migration',
    project: 'acme-api',
    col: 3,
    row: 2,
  },
  {
    id: 'api-decision-session',
    kind: 'decision',
    label: 'decision/session-cookie',
    title: 'HttpOnly session cookie strategy',
    project: 'acme-api',
    col: 5,
    row: 2,
    z: 14,
  },
  {
    id: 'api-spec-errors',
    kind: 'spec',
    label: 'spec/error-taxonomy',
    title: 'Error code taxonomy',
    project: 'acme-api',
    col: 7,
    row: 2,
  },
  {
    id: 'api-task-pagination',
    kind: 'task',
    label: 'task/pagination',
    title: 'Pagination performance',
    project: 'acme-api',
    col: 9,
    row: 2,
  },
  {
    id: 'api-checkpoint-review',
    kind: 'checkpoint',
    label: 'checkpoint/review',
    title: 'API review notes',
    project: 'acme-api',
    col: 11,
    row: 2,
  },

  // acme-portal
  {
    id: 'portal-spec-arch',
    kind: 'spec',
    label: 'spec/portal-arch',
    title: 'Portal frontend architecture',
    project: 'acme-portal',
    col: 0,
    row: 4,
  },
  {
    id: 'portal-task-auth',
    kind: 'task',
    label: 'task/auth-guard',
    title: 'Unified login guard',
    project: 'acme-portal',
    col: 2,
    row: 4,
  },
  {
    id: 'portal-decision-auth',
    kind: 'decision',
    label: 'decision/cookie-migration',
    title: 'Move tokens to HttpOnly cookies',
    project: 'acme-portal',
    col: 4,
    row: 4,
    z: 14,
  },
  {
    id: 'portal-task-search',
    kind: 'task',
    label: 'task/search-ime',
    title: 'Search debounce & IME',
    project: 'acme-portal',
    col: 6,
    row: 4,
  },
  {
    id: 'portal-spec-search',
    kind: 'spec',
    label: 'spec/search-rules',
    title: 'Search interaction rules',
    project: 'acme-portal',
    col: 8,
    row: 4,
  },
  {
    id: 'portal-task-graph',
    kind: 'task',
    label: 'task/graph-radial',
    title: 'Radial graph layout',
    project: 'acme-portal',
    col: 10,
    row: 4,
  },
  {
    id: 'portal-checkpoint-summary',
    kind: 'checkpoint',
    label: 'checkpoint/summary',
    title: 'Session handoff summary',
    project: 'acme-portal',
    col: 11,
    row: 4,
  },

  // design-system
  {
    id: 'ds-spec-tokens',
    kind: 'spec',
    label: 'spec/design-tokens',
    title: 'Design token contract',
    project: 'design-system',
    col: 1,
    row: 6,
  },
  {
    id: 'ds-task-tokens',
    kind: 'task',
    label: 'task/dark-tokens',
    title: 'Dark theme tokens',
    project: 'design-system',
    col: 3,
    row: 6,
  },
  {
    id: 'ds-decision-theme',
    kind: 'decision',
    label: 'decision/theme-persist',
    title: 'Theme persistence model',
    project: 'design-system',
    col: 5,
    row: 6,
    z: 14,
  },
  {
    id: 'ds-spec-components',
    kind: 'spec',
    label: 'spec/component-boundaries',
    title: 'Component boundaries',
    project: 'design-system',
    col: 7,
    row: 6,
  },
  {
    id: 'ds-task-perf',
    kind: 'task',
    label: 'task/perf-canvas',
    title: 'Canvas first paint',
    project: 'design-system',
    col: 9,
    row: 6,
  },
  {
    id: 'ds-task-onboarding',
    kind: 'task',
    label: 'task/onboarding',
    title: 'Contributor onboarding',
    project: 'design-system',
    col: 11,
    row: 6,
  },
];

export const RELATIONS: Relation[] = [
  {
    a: 'portal-task-auth',
    b: 'api-task-auth',
    label: 'depends-on',
  },
  {
    a: 'portal-spec-arch',
    b: 'api-spec-envelope',
    label: 'depends-on',
  },
  {
    a: 'portal-decision-auth',
    b: 'api-decision-session',
    label: 'related',
  },
  {
    a: 'ds-spec-tokens',
    b: 'portal-spec-arch',
    label: 'shares-component',
  },
  {
    a: 'ds-task-perf',
    b: 'portal-task-graph',
    label: 'related',
  },
];

/**
 * Each pulse is a session travelling through the lattice. It crosses
 * project rows, leaves a glow at every artifact and occasionally jumps
 * across a relation edge.
 */
export const PULSE_PATHS: string[][] = [
  [
    'api-spec-envelope',
    'api-task-auth',
    'api-decision-session',
    'portal-task-auth',
    'portal-decision-auth',
  ],
  [
    'portal-spec-arch',
    'portal-task-auth',
    'portal-task-search',
    'portal-spec-search',
    'portal-task-graph',
  ],
  [
    'ds-spec-tokens',
    'ds-task-tokens',
    'ds-decision-theme',
    'portal-task-search',
    'portal-task-graph',
  ],
];
