/**
 * Lattice Workflow Tool Provider — 将 lattice 工作流能力暴露为 Agent tools
 * 直接调用 @qcqx/lattice-core 函数（不走 CLI）
 */
import type { IToolProvider, AgentToolDefinition, AgentToolResult } from '../types.js';

// ── 参数受检读取 ──
// tool args 由模型生成，类型不可信（完全可能给 number/null/对象）。
// 旧实现用 `args.x as string` 直接断言，错类型会静默流进下游报不相关的错；
// 改为实检 + 结构化失败，报错直接指向出错的参数名。

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** 必填字符串（空串视为缺失） */
function requireStr(args: Record<string, unknown>, key: string): Checked<string> {
  const raw = args[key];
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, error: `参数 ${key} 必填且需为非空字符串（得到 ${describeType(raw)}）` };
  }
  return { ok: true, value: raw };
}

/** 可选字符串：非字符串一律当未传（不把垃圾值当过滤条件） */
function optionalStr(args: Record<string, unknown>, key: string): string | undefined {
  const raw = args[key];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/** 批量必填：任一缺失即失败，返回值按 key 强类型展开 */
function requireStrs<K extends string>(
  args: Record<string, unknown>,
  keys: readonly K[],
): Checked<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const field = requireStr(args, key);
    if (!field.ok) return field;
    out[key] = field.value;
  }
  return { ok: true, value: out };
}

function describeType(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

export interface LatticeToolDeps {
  /** 获取当前用户名 */
  getUsername(): Promise<string>;
  /** 获取任务列表 */
  listTasks(opts?: { status?: string }): Promise<{ id: string; title: string; status: string }[]>;
  /** 获取任务详情 */
  getTask(
    taskId: string,
  ): Promise<{ id: string; title: string; status: string; prd?: string } | null>;
  /** 搜索历史 */
  search(
    query: string,
    opts?: { type?: string },
  ): Promise<{ title: string; snippet: string; type: string }[]>;
  /** 获取 spec */
  getSpec(name: string): Promise<{ name: string; content: string; scope: string } | null>;
  /** 列出 spec */
  listSpecs(): Promise<{ name: string; scope: string; summary?: string }[]>;
  /** 添加 checkpoint */
  addCheckpoint(taskId: string, type: string, title: string, message: string): Promise<boolean>;
  /** 获取项目列表 */
  listProjects(): Promise<{ id: string; name: string; localPaths: string[] }[]>;
}

export class LatticeWorkflowProvider implements IToolProvider {
  readonly id = 'lattice-workflow';
  readonly name = 'Lattice Workflow';
  readonly category = 'lattice';

  private deps: LatticeToolDeps;
  private initialized = false;

  constructor(deps: LatticeToolDeps) {
    this.deps = deps;
  }

  async init(): Promise<boolean> {
    this.initialized = true;
    return true;
  }

  getTools(): AgentToolDefinition[] {
    return [
      {
        id: 'lattice.listTasks',
        name: 'listTasks',
        description: '列出 lattice 任务（可按状态过滤）',
        category: 'lattice',
        permission: 'allow',
        parameters: [
          {
            name: 'status',
            type: 'string',
            description: '过滤状态: in_progress/completed/archived',
          },
        ],
      },
      {
        id: 'lattice.getTask',
        name: 'getTask',
        description: '获取任务详情（含 PRD）',
        category: 'lattice',
        permission: 'allow',
        parameters: [{ name: 'taskId', type: 'string', description: '任务 ID', required: true }],
      },
      {
        id: 'lattice.search',
        name: 'searchHistory',
        description: '搜索历史任务、spec、方案',
        category: 'lattice',
        permission: 'allow',
        parameters: [
          { name: 'query', type: 'string', description: '搜索关键词', required: true },
          { name: 'type', type: 'string', description: '类型过滤: task/spec/design' },
        ],
      },
      {
        id: 'lattice.getSpec',
        name: 'getSpec',
        description: '读取指定规范（spec）的完整内容',
        category: 'lattice',
        permission: 'allow',
        parameters: [{ name: 'name', type: 'string', description: 'spec 名称', required: true }],
      },
      {
        id: 'lattice.listSpecs',
        name: 'listSpecs',
        description: '列出所有可用规范',
        category: 'lattice',
        permission: 'allow',
        parameters: [],
      },
      {
        id: 'lattice.addCheckpoint',
        name: 'addCheckpoint',
        description: '为任务添加 checkpoint（记录进展/决策/问题）',
        category: 'lattice',
        permission: 'ask',
        parameters: [
          { name: 'taskId', type: 'string', description: '任务 ID', required: true },
          {
            name: 'type',
            type: 'string',
            description: '类型: decision/milestone/note/issue/context/correction/constraint',
            required: true,
          },
          { name: 'title', type: 'string', description: '标题', required: true },
          { name: 'message', type: 'string', description: '内容', required: true },
        ],
      },
      {
        id: 'lattice.listProjects',
        name: 'listProjects',
        description: '列出已注册项目',
        category: 'lattice',
        permission: 'allow',
        parameters: [],
      },
    ];
  }

  async execute(toolId: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    if (!this.initialized) return { success: false, error: 'Provider not initialized' };

    try {
      switch (toolId) {
        case 'lattice.listTasks': {
          const tasks = await this.deps.listTasks({ status: optionalStr(args, 'status') });
          return { success: true, data: tasks };
        }
        case 'lattice.getTask': {
          const taskId = requireStr(args, 'taskId');
          if (!taskId.ok) return { success: false, error: taskId.error };
          const task = await this.deps.getTask(taskId.value);
          return task ? { success: true, data: task } : { success: false, error: 'Task not found' };
        }
        case 'lattice.search': {
          const query = requireStr(args, 'query');
          if (!query.ok) return { success: false, error: query.error };
          const results = await this.deps.search(query.value, {
            type: optionalStr(args, 'type'),
          });
          return { success: true, data: results };
        }
        case 'lattice.getSpec': {
          const name = requireStr(args, 'name');
          if (!name.ok) return { success: false, error: name.error };
          const spec = await this.deps.getSpec(name.value);
          return spec ? { success: true, data: spec } : { success: false, error: 'Spec not found' };
        }
        case 'lattice.listSpecs': {
          const specs = await this.deps.listSpecs();
          return { success: true, data: specs };
        }
        case 'lattice.addCheckpoint': {
          const fields = requireStrs(args, ['taskId', 'type', 'title', 'message'] as const);
          if (!fields.ok) return { success: false, error: fields.error };
          const ok = await this.deps.addCheckpoint(
            fields.value.taskId,
            fields.value.type,
            fields.value.title,
            fields.value.message,
          );
          return { success: ok };
        }
        case 'lattice.listProjects': {
          const projects = await this.deps.listProjects();
          return { success: true, data: projects };
        }
        default:
          return { success: false, error: `Unknown tool: ${toolId}` };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }
}
