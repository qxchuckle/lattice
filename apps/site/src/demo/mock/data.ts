import type {
  CheckpointEntry,
  CheckpointType,
  ParsedSpec,
  ProjectMeta,
  ProjectRelation,
  ReferencedSpec,
  TaskMeta,
} from '@qcqx/lattice-core';

export const NOW = '2026-10-20T09:00:00.000Z';

export const projects: ProjectMeta[] = [
  {
    ids: ['acme-portal'],
    name: 'Acme Portal',
    description: 'Customer-facing portal and account workspace.',
    localPaths: ['/demo/projects/acme-portal'],
    gitRemotes: ['https://github.com/acme/portal'],
    packageNames: ['acme-portal'],
    gitDefaultBranch: 'main',
    tags: ['web', 'product'],
    created: '2026-08-12T08:00:00.000Z',
    updated: NOW,
  },
  {
    ids: ['acme-api'],
    name: 'Acme API',
    description: 'Public API, auth boundary and service contracts.',
    localPaths: ['/demo/projects/acme-api'],
    gitRemotes: ['https://github.com/acme/api'],
    packageNames: ['acme-api'],
    gitDefaultBranch: 'main',
    tags: ['service', 'auth'],
    created: '2026-07-01T08:00:00.000Z',
    updated: NOW,
  },
  {
    ids: ['design-system'],
    name: 'Acme Design System',
    description: 'Shared tokens, components and accessibility rules.',
    localPaths: ['/demo/projects/design-system'],
    gitRemotes: ['https://github.com/acme/design-system'],
    packageNames: ['@acme/design-system'],
    gitDefaultBranch: 'main',
    tags: ['shared', 'ui'],
    created: '2026-06-18T08:00:00.000Z',
    updated: NOW,
  },
];

function refSpec(
  id: string,
  relativePath: string,
  scope: ReferencedSpec['scope'],
  projectId?: string,
): ReferencedSpec {
  return {
    id,
    relativePath,
    scope,
    projectId,
    firstReadAt: NOW,
  };
}

export const tasks: TaskMeta[] = [
  {
    id: 'task-auth-guard',
    title: 'Unify login state across the portal',
    status: 'in_progress',
    projects: ['acme-portal'],
    referencedSpecs: [
      refSpec('spec-portal-arch', 'portal-architecture.md', 'project', 'acme-portal'),
      refSpec('spec-auth-model', 'auth-model.md', 'project', 'acme-api'),
    ],
    created: '2026-10-14T09:20:00.000Z',
    updated: NOW,
  },
  {
    id: 'task-graph-radial',
    title: 'Radial layout for the knowledge graph',
    status: 'completed',
    projects: ['acme-portal'],
    referencedSpecs: [refSpec('spec-search-rules', 'search-rules.md', 'project', 'acme-portal')],
    created: '2026-10-08T11:00:00.000Z',
    updated: '2026-10-16T16:40:00.000Z',
  },
  {
    id: 'task-search-ime',
    title: 'Search debounce and IME composition',
    status: 'in_progress',
    projects: ['acme-portal'],
    referencedSpecs: [refSpec('spec-search-rules', 'search-rules.md', 'project', 'acme-portal')],
    created: '2026-10-15T10:10:00.000Z',
    updated: NOW,
  },
  {
    id: 'task-api-envelope',
    title: 'API envelope and error taxonomy',
    status: 'completed',
    projects: ['acme-api'],
    referencedSpecs: [refSpec('spec-api-envelope', 'api-envelope.md', 'project', 'acme-api')],
    created: '2026-09-26T09:00:00.000Z',
    updated: '2026-10-10T15:30:00.000Z',
  },
  {
    id: 'task-api-pagination',
    title: 'Cursor pagination for activity feeds',
    status: 'planning',
    projects: ['acme-api'],
    referencedSpecs: [refSpec('spec-api-envelope', 'api-envelope.md', 'project', 'acme-api')],
    created: '2026-10-18T14:00:00.000Z',
    updated: NOW,
  },
  {
    id: 'task-design-tokens',
    title: 'Dark theme token migration',
    status: 'in_progress',
    projects: ['design-system'],
    referencedSpecs: [
      refSpec('spec-design-tokens', 'design-tokens.md', 'project', 'design-system'),
    ],
    created: '2026-10-06T09:30:00.000Z',
    updated: NOW,
  },
  {
    id: 'task-onboarding',
    title: 'Contributor onboarding guide',
    status: 'planning',
    projects: ['design-system'],
    referencedSpecs: [
      refSpec('spec-component-boundaries', 'component-boundaries.md', 'project', 'design-system'),
    ],
    created: '2026-10-19T10:00:00.000Z',
    updated: NOW,
  },
  {
    id: 'task-legacy-auth',
    title: 'Legacy password reset cleanup',
    status: 'archived',
    projects: ['acme-api'],
    referencedSpecs: [refSpec('spec-auth-model', 'auth-model.md', 'project', 'acme-api')],
    created: '2026-08-04T09:00:00.000Z',
    updated: '2026-09-12T11:00:00.000Z',
  },
  {
    id: 'task-perf-canvas',
    title: 'Canvas first-paint budget',
    status: 'in_progress',
    projects: ['acme-portal', 'design-system'],
    referencedSpecs: [
      refSpec('spec-component-boundaries', 'component-boundaries.md', 'project', 'design-system'),
    ],
    created: '2026-10-17T09:45:00.000Z',
    updated: NOW,
  },
];

function spec(input: {
  id: string;
  fileName: string;
  title: string;
  description: string;
  content: string;
  scope: 'global' | 'user' | 'project';
  projectId?: string;
  tags?: string[];
}): ParsedSpec {
  const filePath =
    input.scope === 'project'
      ? `/demo/projects/${input.projectId}/specs/${input.fileName}`
      : input.scope === 'user'
        ? `/demo/users/demo/spec/${input.fileName}`
        : `/demo/spec/${input.fileName}`;
  return {
    frontmatter: {
      id: input.id,
      title: input.title,
      description: input.description,
      tags: input.tags,
      updated: NOW,
    },
    content: input.content,
    filePath,
    fileName: input.fileName,
    relativePath: input.scope === 'project' ? `specs/${input.fileName}` : `spec/${input.fileName}`,
    projectId: input.projectId,
  };
}

export const specs = {
  global: [
    spec({
      id: 'spec-global-workflow',
      fileName: 'ai-workflow.md',
      title: 'AI collaboration workflow',
      description: 'Read context before work, record decisions in flight, distill at archive.',
      scope: 'global',
      tags: ['workflow', 'agents'],
      content: `# AI collaboration workflow

## Before work

Read the project specs, the active task and any project relations before the first prompt.

## During work

Record decisions, corrections and constraints as typed checkpoints. Do not treat chat scrollback
as durable memory.

## At archive

Write a short summary that a future session can reuse. Link the specs and projects involved.
`,
    }),
  ],
  user: [
    spec({
      id: 'spec-user-frontend',
      fileName: 'frontend-conventions.md',
      title: 'Frontend engineering conventions',
      description: 'Component boundaries, accessibility and state ownership for my frontend work.',
      scope: 'user',
      tags: ['frontend', 'conventions'],
      content: `# Frontend engineering conventions

- Keep data fetching at the route boundary; components receive plain data.
- Prefer semantic HTML before adding ARIA.
- Use the shared design system for color, spacing and focus states.
- A component owns its local interaction state, not application data.
`,
    }),
  ],
  project: [
    spec({
      id: 'spec-portal-arch',
      fileName: 'portal-architecture.md',
      title: 'Portal frontend architecture',
      description: 'Route boundaries, state ownership and the portal-to-API contract.',
      scope: 'project',
      projectId: 'acme-portal',
      tags: ['architecture', 'portal'],
      content: `# Portal frontend architecture

## Boundaries

The portal owns presentation and interaction state. Authentication tokens stay in HttpOnly
cookies; the UI never persists them.

## Routes

- \`/login\` is the only unauthenticated route.
- Project and task detail are deep-linkable.
- Graph selection is reflected in the URL.

## API contract

All requests go through the shared client and the API envelope described in
\`api-envelope.md\`.
`,
    }),
    spec({
      id: 'spec-search-rules',
      fileName: 'search-rules.md',
      title: 'Search interaction rules',
      description: 'Debounce, IME composition and empty-state behavior for portal search.',
      scope: 'project',
      projectId: 'acme-portal',
      tags: ['search', 'ux'],
      content: `# Search interaction rules

- Debounce input by 280ms.
- Never fire a query while an IME composition is active.
- Keep the previous result set visible while the next query loads.
- Empty state explains what was searched and how to broaden it.
`,
    }),
    spec({
      id: 'spec-api-envelope',
      fileName: 'api-envelope.md',
      title: 'API envelope and error codes',
      description: 'One response envelope, typed error codes and request tracing.',
      scope: 'project',
      projectId: 'acme-api',
      tags: ['api', 'contract'],
      content: `# API envelope and error codes

Every response uses:

\`\`\`json
{ "data": {}, "error": null, "traceId": "..." }
\`\`\`

Errors carry a stable code, a human message and a retryable flag. Do not leak stack traces.
`,
    }),
    spec({
      id: 'spec-auth-model',
      fileName: 'auth-model.md',
      title: 'Authentication and permissions',
      description: 'Session ownership, cookie boundaries and the permission model.',
      scope: 'project',
      projectId: 'acme-api',
      tags: ['auth', 'security'],
      content: `# Authentication and permissions

- Sessions are HttpOnly, Secure, SameSite=Lax cookies.
- The API owns token rotation; the portal never reads the token.
- Permissions are checked server-side for every mutating endpoint.
`,
    }),
    spec({
      id: 'spec-design-tokens',
      fileName: 'design-tokens.md',
      title: 'Design token contract',
      description: 'Semantic tokens, theme modes and the no-raw-color rule.',
      scope: 'project',
      projectId: 'design-system',
      tags: ['tokens', 'themes'],
      content: `# Design token contract

Use semantic tokens for surface, text, border and accent colors. Components must not contain
raw hex values. Dark and light themes resolve the same semantic names.
`,
    }),
    spec({
      id: 'spec-component-boundaries',
      fileName: 'component-boundaries.md',
      title: 'Component boundaries and reuse',
      description: 'When a component belongs in the design system and when it stays local.',
      scope: 'project',
      projectId: 'design-system',
      tags: ['components', 'reuse'],
      content: `# Component boundaries and reuse

A component belongs in the design system when at least two projects need the same behavior and
accessibility contract. One-off layout stays in the product.
`,
    }),
  ],
};

export const allSpecs: ParsedSpec[] = [...specs.global, ...specs.user, ...specs.project];

export const relations: ProjectRelation[] = [
  {
    id: 'rel-api-portal',
    projectA: 'acme-api',
    projectB: 'acme-portal',
    type: 'depends-on',
    description: 'The portal consumes the public API contract.',
    createdBy: 'manual',
    created: NOW,
  },
  {
    id: 'rel-design-portal',
    projectA: 'acme-portal',
    projectB: 'design-system',
    type: 'shares-component',
    description: 'Portal and design system share the graph and search components.',
    createdBy: 'manual',
    created: NOW,
  },
  {
    id: 'rel-api-design',
    projectA: 'acme-api',
    projectB: 'design-system',
    type: 'related',
    description: 'API error surfaces reuse design-system feedback patterns.',
    createdBy: 'ai-inferred',
    created: NOW,
  },
  {
    id: 'rel-api-portal-auth',
    projectA: 'acme-api',
    projectB: 'acme-portal',
    type: 'related',
    description: 'Auth and session model are co-designed.',
    createdBy: 'manual',
    created: NOW,
  },
];

const checkpoint = (
  id: string,
  time: string,
  type: CheckpointType,
  title: string,
  message: string,
): CheckpointEntry => ({ id, time, type, title, message });

export const progress: Record<string, CheckpointEntry[]> = {
  'task-auth-guard': [
    checkpoint(
      'cp-auth-1',
      '2026-10-14T09:30:00.000Z',
      'context',
      'Session ownership',
      'The portal currently keeps a token in localStorage; the API already supports HttpOnly cookies.',
    ),
    checkpoint(
      'cp-auth-2',
      '2026-10-15T10:15:00.000Z',
      'decision',
      'Move tokens to HttpOnly cookies',
      'The portal will not read the token. The API owns rotation and the logout endpoint.',
    ),
    checkpoint(
      'cp-auth-3',
      '2026-10-16T14:40:00.000Z',
      'milestone',
      'Login guard migrated',
      'The unified guard is live behind a feature flag; legacy password reset is now archived.',
    ),
    checkpoint(
      'cp-auth-4',
      '2026-10-19T16:20:00.000Z',
      'followup',
      'Check the mobile drawer titles',
      'The mobile drawers still use Chinese-only labels; fix with t() before the demo ships.',
    ),
  ],
  'task-search-ime': [
    checkpoint(
      'cp-search-1',
      '2026-10-15T10:20:00.000Z',
      'constraint',
      'Never query during composition',
      'IME composition events must not trigger the debounced search request.',
    ),
    checkpoint(
      'cp-search-2',
      '2026-10-16T11:00:00.000Z',
      'decision',
      'Keep old results while loading',
      'Do not replace the result list with a skeleton; preserve context during the debounce.',
    ),
  ],
  'task-graph-radial': [
    checkpoint(
      'cp-graph-1',
      '2026-10-09T09:00:00.000Z',
      'decision',
      'Use radial as the third layout',
      'Force and sequential stay; radial becomes a presentation mode rather than a replacement.',
    ),
    checkpoint(
      'cp-graph-2',
      '2026-10-12T15:30:00.000Z',
      'milestone',
      'Radial layout validated',
      'The graph remains readable at 15 nodes and 4 relation edges.',
    ),
    checkpoint(
      'cp-graph-3',
      '2026-10-16T16:40:00.000Z',
      'summary',
      'Radial layout shipped',
      'The layout switch is in the floating status bar; no separate canvas state is needed.',
    ),
  ],
  'task-api-envelope': [
    checkpoint(
      'cp-api-1',
      '2026-09-26T09:20:00.000Z',
      'decision',
      'One envelope for every response',
      'Data, error and traceId are always present. Clients can branch without guessing the shape.',
    ),
    checkpoint(
      'cp-api-2',
      '2026-10-02T13:10:00.000Z',
      'issue',
      'Legacy errors leak internals',
      'The old handler returned stack traces in development builds; the new taxonomy strips them.',
    ),
    checkpoint(
      'cp-api-3',
      '2026-10-10T15:30:00.000Z',
      'summary',
      'Envelope adopted across services',
      'All public endpoints now use the shared error taxonomy.',
    ),
  ],
  'task-design-tokens': [
    checkpoint(
      'cp-tokens-1',
      '2026-10-06T09:40:00.000Z',
      'context',
      'Two themes, one token set',
      'Components should resolve semantic names instead of branching on theme.',
    ),
    checkpoint(
      'cp-tokens-2',
      '2026-10-11T14:00:00.000Z',
      'correction',
      'Stop using raw hex in the portal',
      'The first migration pass left raw colors in the search panel; move them to semantic tokens.',
    ),
  ],
  'task-perf-canvas': [
    checkpoint(
      'cp-canvas-1',
      '2026-10-17T10:00:00.000Z',
      'constraint',
      'The canvas must not block the H1',
      'The hero visual loads after first paint and never becomes the LCP element.',
    ),
    checkpoint(
      'cp-canvas-2',
      '2026-10-18T12:30:00.000Z',
      'decision',
      'Pause when offscreen or hidden',
      'Use IntersectionObserver plus document visibility; the ticker and pulse timelines share one state.',
    ),
  ],
  'task-onboarding': [
    checkpoint(
      'cp-onboard-1',
      '2026-10-19T10:15:00.000Z',
      'assumption',
      'A task-first guide is enough',
      'New contributors need a path from project registration to the first checkpoint, not a full manual.',
    ),
  ],
  'task-api-pagination': [
    checkpoint(
      'cp-page-1',
      '2026-10-18T14:20:00.000Z',
      'context',
      'Activity feeds need stable cursors',
      'Offset pagination breaks when new activity is inserted at the top.',
    ),
  ],
  'task-legacy-auth': [
    checkpoint(
      'cp-legacy-1',
      '2026-09-12T11:00:00.000Z',
      'summary',
      'Legacy reset flow archived',
      'The flow is superseded by the cookie-based session model.',
    ),
  ],
};

export const content: Record<string, string> = {
  'prd:task-auth-guard': `# Unify login state across the portal

## Goal

One authentication boundary for the portal and API. The portal should never read or persist an
access token.

## Scope

- Replace localStorage token handling with HttpOnly cookies.
- Unify the login guard and logout flow.
- Keep the legacy password reset archived.

## Acceptance

- No token appears in localStorage or sessionStorage.
- Unauthenticated users land on \`/login\`.
- Logout clears the cookie through the API.
`,
  'design:task-auth-guard': `# Auth guard design

## Request flow

1. The login form posts to the API.
2. The API sets an HttpOnly cookie and returns the user profile.
3. The portal stores only the profile in memory.

## Edge cases

- Expired session: the API returns \`AUTH_EXPIRED\`; the client redirects to login.
- Multiple tabs: logout in one tab should invalidate the others on the next request.
`,
  'progress:task-auth-guard': `entries:
  - id: cp-auth-1
    type: context
    title: Session ownership
    message: The portal currently keeps a token in localStorage.
  - id: cp-auth-2
    type: decision
    title: Move tokens to HttpOnly cookies
  - id: cp-auth-3
    type: milestone
    title: Login guard migrated
  - id: cp-auth-4
    type: followup
    title: Check the mobile drawer titles
`,
  'prd:task-search-ime': `# Search debounce and IME composition

## Goal

Search feels immediate without firing requests during IME composition.

## Acceptance

- 280ms debounce.
- No query while composing.
- Previous results remain visible during loading.
`,
  'design:task-search-ime': `# Search interaction design

The search input owns a small state machine: idle → composing → debouncing → loading → results.
The result list keeps the previous data visible while the next query is in flight.
`,
  'progress:task-search-ime': `entries:
  - id: cp-search-1
    type: constraint
    title: Never query during composition
  - id: cp-search-2
    type: decision
    title: Keep old results while loading
`,
  'prd:task-graph-radial': `# Radial layout for the knowledge graph

## Goal

Add a radial presentation mode that keeps the graph readable at demo scale.

## Acceptance

- The layout switch exposes force, sequential and radial.
- Existing filters and selection survive a layout change.
`,
  'design:task-graph-radial': `# Radial layout design

Radial is a presentation mode. It does not change graph data or filters. The selected node
stays selected and is re-centered after layout.
`,
  'progress:task-graph-radial': `entries:
  - id: cp-graph-1
    type: decision
    title: Use radial as the third layout
  - id: cp-graph-2
    type: milestone
    title: Radial layout validated
  - id: cp-graph-3
    type: summary
    title: Radial layout shipped
`,
  'prd:task-api-envelope': `# API envelope and error taxonomy

## Goal

Every response has the same shape and every error has a stable code.

## Acceptance

- Responses include data, error and traceId.
- Errors are retryable-aware.
- No stack traces leave the service.
`,
  'design:task-api-envelope': `# Envelope design

The client has one decoder. A non-null error is a typed object with code, message and retryable.
The traceId is attached to logs and surfaced in the UI only on request.
`,
  'progress:task-api-envelope': `entries:
  - id: cp-api-1
    type: decision
    title: One envelope for every response
  - id: cp-api-2
    type: issue
    title: Legacy errors leak internals
  - id: cp-api-3
    type: summary
    title: Envelope adopted across services
`,
  'prd:task-design-tokens': `# Dark theme token migration

## Goal

Move the design system to semantic tokens that resolve in both themes.

## Acceptance

- No raw hex values in product components.
- Dark and light themes share the same semantic names.
`,
  'design:task-design-tokens': `# Token migration design

Tokens are grouped by surface, text, border and accent. A theme is a shallow override of the
same names, so components never branch on mode.
`,
  'progress:task-design-tokens': `entries:
  - id: cp-tokens-1
    type: context
    title: Two themes, one token set
  - id: cp-tokens-2
    type: correction
    title: Stop using raw hex in the portal
`,
  'prd:task-perf-canvas': `# Canvas first-paint budget

## Goal

Keep the hero canvas out of the critical path and preserve the H1 as LCP.

## Acceptance

- Canvas JS loads after first paint.
- Offscreen and hidden pages pause all motion.
- Reduced motion renders one static frame.
`,
  'design:task-perf-canvas': `# Canvas performance design

PixiJS is dynamically imported after idle. Pixel ratio is capped at 2. The scene pauses through
one shared playback state used by the ticker and the GSAP pulse timelines.
`,
  'progress:task-perf-canvas': `entries:
  - id: cp-canvas-1
    type: constraint
    title: The canvas must not block the H1
  - id: cp-canvas-2
    type: decision
    title: Pause when offscreen or hidden
`,
  'prd:task-onboarding': `# Contributor onboarding guide

## Goal

A task-first path from project registration to the first checkpoint.
`,
  'design:task-onboarding': `# Onboarding design

Start with the current repo. Register it, scan it, create one task and record one decision.
Do not teach every feature before the first success.
`,
  'progress:task-onboarding': `entries:
  - id: cp-onboard-1
    type: assumption
    title: A task-first guide is enough
`,
  'prd:task-api-pagination': `# Cursor pagination for activity feeds

## Goal

Stable pagination while new activity arrives.
`,
  'design:task-api-pagination': `# Pagination design

Use an opaque cursor derived from timestamp and id. Never use offset for insertion-heavy feeds.
`,
  'progress:task-api-pagination': `entries:
  - id: cp-page-1
    type: context
    title: Activity feeds need stable cursors
`,
  'prd:task-legacy-auth': `# Legacy password reset cleanup

Archived after the cookie-based session model shipped.
`,
  'design:task-legacy-auth': `# Legacy auth cleanup

Keep the archived task as context. Do not resurrect the reset flow.
`,
  'progress:task-legacy-auth': `entries:
  - id: cp-legacy-1
    type: summary
    title: Legacy reset flow archived
`,
};

for (const item of allSpecs) {
  content[`spec:${item.frontmatter.id}`] = item.content;
}
