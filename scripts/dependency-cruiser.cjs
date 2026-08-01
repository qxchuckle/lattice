/**
 * dependency-cruiser 配置 —— 把 spec「Agent 包分层与类型归属规则」(spec-r0btpt62)
 * 的分层约束固化为机器规则。
 *
 * 依赖方向（单向，禁止反向）：
 *
 *   agent-protocol（契约层：根出口零运行时依赖，/schemas 子出口带 zod）
 *       ↑                    ↖
 *   agent-source          agent-pipeline（只依赖 protocol，不依赖 agent-source）
 *       ↖                    ↗
 *              agent（lattice 宿主编排）
 *                 ↑
 *        web / cli / acp-gateway（壳层）
 *
 * 说明：
 * - cli / core 不在本规则的分层范围内（见任务约定），仅参与全仓禁循环与
 *   deep-import 检查；规则一律用 pathNot 放行，避免误报。
 * - 只扫描 packages 各包 src；跨包依赖经 pnpm workspace 符号链接解析到
 *   packages/<pkg>/dist 的出口文件上，doNotFollow 保证不深入 dist 图。
 * - 本配置从仓库根执行（pnpm depcruise），规则中的路径与 tsConfig 均相对仓库根。
 */
module.exports = {
  forbidden: [
    /* ── 全仓 ─────────────────────────────────────────────── */
    {
      name: 'no-circular',
      severity: 'error',
      comment: '全仓禁止循环依赖（模块级）',
      from: {
        path: '^packages/',
      },
      to: { circular: true },
    },
    {
      name: 'no-unresolvable-workspace-import',
      severity: 'error',
      comment: '@qcqx/* import 无法解析 —— 通常是绕过包出口（exports）的非法 deep import',
      from: {},
      to: { couldNotResolve: true, path: '^@qcqx/' },
    },
    {
      name: 'no-cross-package-deep-import',
      severity: 'error',
      comment:
        '跨包只准走包出口：dist/index.*、protocol 的 /schemas、source 的 /testing、web 的 server 出口；' +
        '禁止直捣其他包内部路径（含 src 直连）',
      from: { path: '^packages/([^/]+)/' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/$1/',
          '^packages/[^/]+/dist/index\\.(js|mjs|cjs|d\\.ts|d\\.mts|d\\.cts)$',
          // 源码根出口（tsConfig 用 refs.base.json 的 paths 解析到 src，fresh clone 无 dist 亦合法）
          '^packages/[^/]+/src/index\\.ts$',
          // spec：protocol 双出口，/schemas 子出口承载 zod schema
          '^packages/agent-protocol/dist/schemas\\.(js|d\\.ts)$',
          '^packages/agent-protocol/src/schemas\\.ts$',
          // spec：agent-source 的 /testing 子出口（契约套件 / 离线 fake 源）
          '^packages/agent-source/dist/testing/index\\.(js|d\\.ts)$',
          '^packages/agent-source/src/testing/index\\.ts$',
          // web 包出口指向 dist/server/index.*（cli 经此挂载 web 服务）
          '^packages/web/dist/server/index\\.(js|d\\.ts)$',
          '^packages/web/src/server/index\\.ts$',
        ],
      },
    },

    /* ── agent-protocol（契约层）──────────────────────────── */
    {
      name: 'protocol-no-workspace-deps',
      severity: 'error',
      comment: 'spec：protocol 是契约层，不得 import 任何其他 @qcqx 包',
      from: { path: '^packages/agent-protocol/src' },
      to: { path: '^packages/', pathNot: '^packages/agent-protocol/' },
    },
    {
      name: 'protocol-root-zero-runtime-deps',
      severity: 'error',
      comment:
        'spec：根出口保持运行时零依赖（零 npm 依赖）；zod 只准出现在 /schemas 子出口（src/schemas.ts）',
      from: {
        path: '^packages/agent-protocol/src',
        pathNot: '^packages/agent-protocol/src/schemas\\.ts$',
      },
      to: { path: 'node_modules' },
    },
    {
      name: 'protocol-root-not-to-schemas',
      severity: 'error',
      comment: 'spec：根出口不得引入 schemas（否则根出口被 zod 污染，破坏零依赖承诺）',
      from: {
        path: '^packages/agent-protocol/src',
        pathNot: '^packages/agent-protocol/src/schemas\\.ts$',
      },
      to: { path: '^packages/agent-protocol/src/schemas\\.ts$' },
    },

    /* ── agent-source（源实现层）──────────────────────────── */
    {
      name: 'source-only-depends-on-protocol',
      severity: 'error',
      comment: 'spec：agent-source 只依赖 agent-protocol',
      from: { path: '^packages/agent-source/src' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/agent-source/', '^packages/agent-protocol/'],
      },
    },

    /* ── agent-pipeline（能力消费层）──────────────────────── */
    {
      name: 'pipeline-only-depends-on-protocol',
      severity: 'error',
      comment:
        'spec 关键约束：pipeline 不依赖 agent-source（只消费 ISource 接口），只依赖 protocol',
      from: { path: '^packages/agent-pipeline/src' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/agent-pipeline/', '^packages/agent-protocol/'],
      },
    },

    /* ── agent（lattice 宿主编排层）───────────────────────── */
    {
      name: 'agent-allowed-deps-only',
      severity: 'error',
      comment:
        'spec 依赖图：agent 的依赖面 = protocol + source + pipeline；不得依赖壳层（web/cli），' +
        '也不引 core（spec 依赖图未含 core，当前 src 亦无此依赖）',
      from: { path: '^packages/agent/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/agent/',
          '^packages/agent-protocol/',
          '^packages/agent-source/',
          '^packages/agent-pipeline/',
        ],
      },
    },

    /* ── web（壳层）───────────────────────────────────────── */
    {
      name: 'web-shell-allowed-deps-only',
      severity: 'error',
      comment:
        'spec：壳层从 agent 或 protocol import；web server 侧另依赖 core（领域中心）。' +
        '不得绕过 agent 直接依赖 agent-source / agent-pipeline，更不得依赖 cli',
      from: { path: '^packages/web/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/web/',
          '^packages/agent/',
          '^packages/agent-protocol/',
          '^packages/core/',
        ],
      },
    },
    {
      name: 'web-client-no-schemas-import',
      severity: 'error',
      comment: 'spec：client 禁止 import protocol 的 /schemas（浏览器 bundle 必须零 zod）',
      from: { path: '^packages/web/src/client' },
      to: { path: '^packages/agent-protocol/(dist|src)/schemas' },
    },
  ],
  options: {
    doNotFollow: {
      // 跨包依赖记录到 dist 出口即止，不深入被依赖包的产物图
      path: ['node_modules', '^packages/[^/]+/dist'],
    },
    exclude: {
      path: [
        '\\.(test|spec)\\.[cm]?[jt]sx?$',
        '(^|/)tests?/',
        '(^|/)coverage/',
        '(^|/)dist/.+\\.map$',
      ],
    },
    // 把 type-only import 也纳入图（分层规则对类型依赖同样生效）
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.refs.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
