/**
 * Lattice 配置页字段声明（host + webview 共用，vscode-free）。
 *
 * 单一真源：页面渲染、搜索、保存校验都读这里；测试校验 package.json 的
 * `lattice.*` 设置全部有声明，防止新增设置后配置页漏字段。
 */

export type ConfigFieldType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'select'
  | 'multiselect'
  | 'stringArray'
  | 'path'
  | 'pathArray'
  | 'model';

export type ConfigFieldStore = 'vscode' | 'coreGlobal' | 'coreLocal';

export interface ConfigOption {
  value: string;
  label: { zh: string; en: string };
}

export interface ConfigFieldSchema {
  key: string;
  store: ConfigFieldStore;
  group: string;
  groupLabel: { zh: string; en: string };
  label: { zh: string; en: string };
  description: { zh: string; en: string };
  type: ConfigFieldType;
  default?: unknown;
  options?: readonly ConfigOption[];
  min?: number;
  max?: number;
  placeholder?: string;
  risk?: 'low' | 'medium' | 'high';
  advanced?: boolean;
  requiresReload?: boolean;
  requiresRagRebuild?: boolean;
}

const GROUP = {
  data: { zh: '数据与刷新', en: 'Data & refresh' },
  tasks: { zh: '任务视图', en: 'Tasks' },
  search: { zh: '搜索', en: 'Search' },
  graph: { zh: '图谱', en: 'Graph' },
  status: { zh: '状态栏', en: 'Status bar' },
  editor: { zh: '编辑器集成', en: 'Editor integration' },
  diagnostics: { zh: '诊断', en: 'Diagnostics' },
  rag: { zh: 'RAG 与模型', en: 'RAG & model' },
  templates: { zh: '模板', en: 'Templates' },
  local: { zh: '本机', en: 'Local' },
} as const;

function option(value: string, zh: string, en: string): ConfigOption {
  return { value, label: { zh, en } };
}

/** VS Code 扩展设置（contributes.configuration）。 */
export const VSCODE_FIELDS: readonly ConfigFieldSchema[] = [
  {
    key: 'lattice.latticeHome',
    store: 'vscode',
    group: 'data',
    groupLabel: GROUP.data,
    label: { zh: 'Lattice 数据根目录', en: 'Lattice data root' },
    description: {
      zh: '留空使用 ~/.lattice；修改后会切换数据源并需要重载窗口。',
      en: 'Leave empty for ~/.lattice. Changing it switches the data source and requires a window reload.',
    },
    type: 'path',
    default: '',
    risk: 'high',
    requiresReload: true,
    advanced: true,
  },
  {
    key: 'lattice.minCliVersion',
    store: 'vscode',
    group: 'diagnostics',
    groupLabel: GROUP.diagnostics,
    label: { zh: '最低运行时版本', en: 'Minimum runtime version' },
    description: {
      zh: '扩展检查 Lattice 核心版本时使用。',
      en: 'Used by the extension when checking the Lattice core version.',
    },
    type: 'string',
    default: '1.28.0',
    advanced: true,
  },
  {
    key: 'lattice.autoRefresh',
    store: 'vscode',
    group: 'data',
    groupLabel: GROUP.data,
    label: { zh: '自动刷新', en: 'Auto refresh' },
    description: {
      zh: '文件变化时自动刷新侧栏和详情。',
      en: 'Refresh sidebars and details when files change.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.refreshDebounce',
    store: 'vscode',
    group: 'data',
    groupLabel: GROUP.data,
    label: { zh: '刷新防抖（ms）', en: 'Refresh debounce (ms)' },
    description: { zh: '文件事件合并窗口。', en: 'File event coalescing window.' },
    type: 'number',
    default: 400,
    min: 0,
  },
  {
    key: 'lattice.fallbackPollMs',
    store: 'vscode',
    group: 'data',
    groupLabel: GROUP.data,
    label: { zh: '轮询兜底（ms）', en: 'Fallback polling (ms)' },
    description: {
      zh: '文件监听不可用时的轮询间隔；0 表示关闭。',
      en: 'Polling interval when file watching is unavailable; 0 disables.',
    },
    type: 'number',
    default: 30000,
    min: 0,
  },
  {
    key: 'lattice.tasks.scope',
    store: 'vscode',
    group: 'tasks',
    groupLabel: GROUP.tasks,
    label: { zh: '任务范围', en: 'Task scope' },
    description: {
      zh: '标题栏切换的临时覆盖优先；保存此设置会清除覆盖。',
      en: 'The title-bar override takes precedence; saving this setting clears it.',
    },
    type: 'select',
    default: 'all',
    options: [
      option('all', '全部项目', 'All projects'),
      option('project', '当前项目', 'Current project'),
    ],
  },
  {
    key: 'lattice.tasks.showArchived',
    store: 'vscode',
    group: 'tasks',
    groupLabel: GROUP.tasks,
    label: { zh: '显示归档任务', en: 'Show archived tasks' },
    description: {
      zh: '任务视图中是否显示已归档任务。',
      en: 'Show archived tasks in the task view.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.search.types',
    store: 'vscode',
    group: 'search',
    groupLabel: GROUP.search,
    label: { zh: '默认搜索类型', en: 'Default search types' },
    description: { zh: '留空表示全部类型。', en: 'Empty means all types.' },
    type: 'multiselect',
    default: [],
    options: [
      option('project', '项目', 'Projects'),
      option('task', '任务', 'Tasks'),
      option('spec', '规范', 'Specs'),
      option('checkpoint', '检查点', 'Checkpoints'),
      option('relation', '关系', 'Relations'),
    ],
  },
  {
    key: 'lattice.search.limit',
    store: 'vscode',
    group: 'search',
    groupLabel: GROUP.search,
    label: { zh: '搜索结果上限', en: 'Search result limit' },
    description: { zh: '0 表示不限制。', en: '0 means unlimited.' },
    type: 'number',
    default: 0,
    min: 0,
  },
  {
    key: 'lattice.graph.defaultLayout',
    store: 'vscode',
    group: 'graph',
    groupLabel: GROUP.graph,
    label: { zh: '图谱默认布局', en: 'Default graph layout' },
    description: { zh: '打开图谱时使用的布局。', en: 'Layout used when opening the graph.' },
    type: 'select',
    default: 'force',
    options: [
      option('force', '力导向', 'Force'),
      option('sequential', '顺序', 'Sequential'),
      option('radial', '径向', 'Radial'),
    ],
  },
  {
    key: 'lattice.graph.keepContext',
    store: 'vscode',
    group: 'graph',
    groupLabel: GROUP.graph,
    label: { zh: '保持图谱上下文', en: 'Keep graph context' },
    description: {
      zh: '切换标签时保留图谱状态；下次打开生效。',
      en: 'Keep graph state when switching tabs; applies next open.',
    },
    type: 'boolean',
    default: false,
  },
  {
    key: 'lattice.statusBar.project',
    store: 'vscode',
    group: 'status',
    groupLabel: GROUP.status,
    label: { zh: '状态栏显示项目', en: 'Show project in status bar' },
    description: {
      zh: '在状态栏显示当前项目。',
      en: 'Show the current project in the status bar.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.statusBar.activeTasks',
    store: 'vscode',
    group: 'status',
    groupLabel: GROUP.status,
    label: { zh: '状态栏显示活跃任务', en: 'Show active tasks in status bar' },
    description: {
      zh: '在状态栏显示进行中任务数。',
      en: 'Show in-progress task count in the status bar.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.statusBar.user',
    store: 'vscode',
    group: 'status',
    groupLabel: GROUP.status,
    label: { zh: '状态栏显示用户', en: 'Show user in status bar' },
    description: { zh: '在状态栏显示当前用户。', en: 'Show the current user in the status bar.' },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.editor.specLinks',
    store: 'vscode',
    group: 'editor',
    groupLabel: GROUP.editor,
    label: { zh: 'Spec 链接', en: 'Spec links' },
    description: {
      zh: '在 Markdown 等文档中识别 Spec 链接。',
      en: 'Detect spec links in Markdown and other documents.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.decorations.enabled',
    store: 'vscode',
    group: 'editor',
    groupLabel: GROUP.editor,
    label: { zh: '文件装饰', en: 'File decorations' },
    description: {
      zh: '在资源管理器中标记当前任务范围。',
      en: 'Mark the active task scope in the explorer.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.documents.ragHintOnSave',
    store: 'vscode',
    group: 'editor',
    groupLabel: GROUP.editor,
    label: { zh: '保存后提示同步 RAG', en: 'RAG sync hint on save' },
    description: {
      zh: '保存 Spec 后提示 migrate + rag update。',
      en: 'Prompt to migrate + update RAG after saving a spec.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.specDiagnostics.enabled',
    store: 'vscode',
    group: 'editor',
    groupLabel: GROUP.editor,
    label: { zh: 'Spec 体检', en: 'Spec diagnostics' },
    description: {
      zh: '将规范 lint / 冲突写入 Problems。',
      en: 'Publish spec lint / conflicts to Problems.',
    },
    type: 'boolean',
    default: true,
  },
  {
    key: 'lattice.trace',
    store: 'vscode',
    group: 'diagnostics',
    groupLabel: GROUP.diagnostics,
    label: { zh: '跟踪日志', en: 'Trace logging' },
    description: { zh: '输出更详细的扩展日志。', en: 'Emit more detailed extension logs.' },
    type: 'boolean',
    default: false,
    advanced: true,
  },
];

/** 全局配置（config.json）中可安全表单化的字段。 */
export const CORE_GLOBAL_FIELDS: readonly ConfigFieldSchema[] = [
  {
    key: 'rag.embedding.modelId',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: 'Embedding 模型', en: 'Embedding model' },
    description: {
      zh: '选择已知模型会同步维度 / 精度 / 池化 / 前缀；保存后需要重建索引。',
      en: 'Known models sync dimension / dtype / pooling / prefixes; rebuilding the index is required after saving.',
    },
    type: 'model',
    risk: 'high',
    requiresRagRebuild: true,
  },
  {
    key: 'rag.embedding.dimension',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '向量维度', en: 'Vector dimension' },
    description: { zh: '必须与模型输出维度一致。', en: 'Must match the model output dimension.' },
    type: 'number',
    min: 1,
    risk: 'high',
    requiresRagRebuild: true,
  },
  {
    key: 'rag.embedding.dtype',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '模型精度', en: 'Model dtype' },
    description: {
      zh: '量化精度；q8 体积小，fp32 精度高。',
      en: 'Quantization precision; q8 is smaller, fp32 is more precise.',
    },
    type: 'select',
    options: [
      option('q8', 'q8', 'q8'),
      option('fp16', 'fp16', 'fp16'),
      option('fp32', 'fp32', 'fp32'),
      option('int8', 'int8', 'int8'),
    ],
    risk: 'high',
    requiresRagRebuild: true,
    advanced: true,
  },
  {
    key: 'rag.embedding.pooling',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '池化策略', en: 'Pooling' },
    description: { zh: 'mean 或 cls。', en: 'mean or cls.' },
    type: 'select',
    options: [option('mean', 'mean', 'mean'), option('cls', 'cls', 'cls')],
    risk: 'high',
    requiresRagRebuild: true,
    advanced: true,
  },
  {
    key: 'rag.embedding.queryPrefix',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '查询前缀', en: 'Query prefix' },
    description: { zh: '部分模型要求查询文本带前缀。', en: 'Some models require a query prefix.' },
    type: 'string',
    risk: 'high',
    requiresRagRebuild: true,
    advanced: true,
  },
  {
    key: 'rag.embedding.documentPrefix',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '文档前缀', en: 'Document prefix' },
    description: {
      zh: '部分模型要求文档文本带前缀。',
      en: 'Some models require a document prefix.',
    },
    type: 'string',
    risk: 'high',
    requiresRagRebuild: true,
    advanced: true,
  },
  {
    key: 'rag.embedding.remoteHost',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '模型下载源', en: 'Model remote host' },
    description: { zh: 'HuggingFace 或镜像地址。', en: 'HuggingFace or a mirror URL.' },
    type: 'string',
    advanced: true,
  },
  {
    key: 'rag.embedding.remotePathTemplate',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '下载路径模板', en: 'Remote path template' },
    description: { zh: '通常无需修改。', en: 'Usually no need to change.' },
    type: 'string',
    advanced: true,
  },
  {
    key: 'rag.embedding.proxy',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '代理', en: 'Proxy' },
    description: {
      zh: '下载模型时使用的 HTTP(S) 代理。',
      en: 'HTTP(S) proxy for model downloads.',
    },
    type: 'string',
    advanced: true,
  },
  {
    key: 'rag.embedding.localModelPath',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '本地模型目录', en: 'Local model directory' },
    description: { zh: '可选的本地模型搜索目录。', en: 'Optional local model search directory.' },
    type: 'path',
    advanced: true,
  },
  {
    key: 'rag.embedding.cacheDir',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '模型缓存目录', en: 'Model cache directory' },
    description: { zh: '留空使用默认缓存。', en: 'Empty uses the default cache.' },
    type: 'path',
    advanced: true,
  },
  {
    key: 'rag.embedding.allowRemoteModels',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '允许远程模型', en: 'Allow remote models' },
    description: { zh: '关闭后只使用本地模型。', en: 'When off, only local models are used.' },
    type: 'boolean',
    advanced: true,
  },
  {
    key: 'rag.embedding.allowLocalModels',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '允许本地模型', en: 'Allow local models' },
    description: {
      zh: '允许从本地目录加载模型。',
      en: 'Allow loading models from local directories.',
    },
    type: 'boolean',
    advanced: true,
  },
  {
    key: 'rag.embedding.distanceThreshold',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '语义距离阈值', en: 'Distance threshold' },
    description: { zh: '语义检索结果过滤阈值。', en: 'Filter threshold for semantic search.' },
    type: 'number',
    advanced: true,
  },
  {
    key: 'rag.embedding.excerptLength',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: 'Embedding 文本长度', en: 'Embedding excerpt length' },
    description: { zh: '写入向量的文本最大长度。', en: 'Maximum text length used for embeddings.' },
    type: 'number',
    advanced: true,
  },
  {
    key: 'rag.embedding.batchSize',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '批量大小', en: 'Batch size' },
    description: { zh: '推理批量大小。', en: 'Inference batch size.' },
    type: 'number',
    advanced: true,
  },
  {
    key: 'rag.embedding.minChunkSize',
    store: 'coreGlobal',
    group: 'rag',
    groupLabel: GROUP.rag,
    label: { zh: '最小分片', en: 'Minimum chunk size' },
    description: { zh: '分片合并阈值。', en: 'Chunk merge threshold.' },
    type: 'number',
    advanced: true,
  },
  {
    key: 'registryTemplates',
    store: 'coreGlobal',
    group: 'templates',
    groupLabel: GROUP.templates,
    label: { zh: '模板仓库', en: 'Template registries' },
    description: { zh: 'Spec 模板仓库地址列表。', en: 'Spec template registry URLs.' },
    type: 'stringArray',
  },
];

/** 本机配置（config-local.json）中可安全表单化的字段。 */
export const CORE_LOCAL_FIELDS: readonly ConfigFieldSchema[] = [
  {
    key: 'scanDirs',
    store: 'coreLocal',
    group: 'local',
    groupLabel: GROUP.local,
    label: { zh: '扫描目录', en: 'Scan directories' },
    description: {
      zh: '项目扫描的默认目录列表。',
      en: 'Default directories used for project scanning.',
    },
    type: 'pathArray',
  },
  {
    key: 'gitEnabled',
    store: 'coreLocal',
    group: 'local',
    groupLabel: GROUP.local,
    label: { zh: '启用主数据仓 Git', en: 'Enable data-repo Git' },
    description: {
      zh: '是否用 Git 管理 ~/.lattice 主数据仓。',
      en: 'Manage the ~/.lattice data repo with Git.',
    },
    type: 'boolean',
  },
  {
    key: 'gitRemote',
    store: 'coreLocal',
    group: 'local',
    groupLabel: GROUP.local,
    label: { zh: '主数据仓 Remote', en: 'Data-repo remote' },
    description: {
      zh: '~/.lattice 主数据仓的 remote；不是项目代码仓。',
      en: 'Remote for the ~/.lattice data repo, not project code repositories.',
    },
    type: 'string',
  },
  {
    key: 'language',
    store: 'coreLocal',
    group: 'local',
    groupLabel: GROUP.local,
    label: { zh: '文档语言', en: 'Document language' },
    description: {
      zh: '注入给 AI 客户端的文档语言。',
      en: 'Document language injected into AI clients.',
    },
    type: 'select',
    default: 'auto',
    options: [
      option('auto', '自动', 'Auto'),
      option('zh', '中文', 'Chinese'),
      option('en', 'English', 'English'),
    ],
  },
  {
    key: 'registryTemplates',
    store: 'coreLocal',
    group: 'templates',
    groupLabel: GROUP.templates,
    label: { zh: '本机模板仓库', en: 'Local template registries' },
    description: {
      zh: '覆盖全局模板仓库列表。',
      en: 'Overrides the global template registry list.',
    },
    type: 'stringArray',
  },
];

/** 与 core `EMBEDDING_MODEL_PRESETS` 对齐的模型候选（配置页自动补全用）。 */
export const EMBEDDING_MODEL_OPTIONS: readonly ConfigOption[] = [
  option('Xenova/bge-small-zh-v1.5', 'BGE Small 中文（默认）', 'BGE Small Chinese (default)'),
  option('Xenova/all-MiniLM-L6-v2', 'MiniLM 英文轻量', 'MiniLM English light'),
  option('Xenova/multilingual-e5-small', 'Multilingual E5 Small', 'Multilingual E5 Small'),
  option(
    'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    'Paraphrase Multilingual MiniLM',
    'Paraphrase Multilingual MiniLM',
  ),
  option('BAAI/bge-base-zh-v1.5', 'BGE Base 中文', 'BGE Base Chinese'),
];

export const ALL_CONFIG_FIELDS: readonly ConfigFieldSchema[] = [
  ...VSCODE_FIELDS,
  ...CORE_GLOBAL_FIELDS,
  ...CORE_LOCAL_FIELDS,
];

const VSCODE_KEYS = new Set(VSCODE_FIELDS.map((field) => field.key));

export function isKnownVscodeSetting(key: string): boolean {
  return VSCODE_KEYS.has(key);
}

/** `lattice.tasks.scope` → `tasks.scope`（WorkspaceConfiguration 相对 key）。 */
export function vscodeConfigKey(key: string): string {
  return key.startsWith('lattice.') ? key.slice('lattice.'.length) : key;
}
