/**
 * Lattice Workflow Tool Provider — 将 lattice 工作流能力暴露为 Agent tools
 * 直接调用 @qcqx/lattice-core 函数（不走 CLI）
 */
import type { IToolProvider, ToolDefinition, ToolResult } from '../types.js';

export interface LatticeToolDeps {
  /** 获取当前用户名 */
  getUsername(): Promise<string>;
  /** 获取任务列表 */
  listTasks(opts?: { status?: string }): Promise<{ id: string; title: string; status: string }[]>;
  /** 获取任务详情 */
  getTask(taskId: string): Promise<{ id: string; title: string; status: string; prd?: string } | null>;
  /** 搜索历史 */
  search(query: string, opts?: { type?: string }): Promise<{ title: string; snippet: string; type: string }[]>;
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

  getTools(): ToolDefinition[] {
    return [
      {
        id: 'lattice.listTasks',
        name: 'listTasks',
        description: '列出 lattice 任务（可按状态过滤）',
        category: 'lattice',
        permission: 'allow',
        parameters: [{ name: 'status', type: 'string', description: '过滤状态: in_progress/completed/archived' }],
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
          { name: 'type', type: 'string', description: '类型: decision/milestone/note/issue/context/correction/constraint', required: true },
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

  async execute(toolId: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.initialized) return { success: false, error: 'Provider not initialized' };

    try {
      switch (toolId) {
        case 'lattice.listTasks': {
          const tasks = await this.deps.listTasks({ status: args.status as string | undefined });
          return { success: true, data: tasks };
        }
        case 'lattice.getTask': {
          const task = await this.deps.getTask(args.taskId as string);
          return task ? { success: true, data: task } : { success: false, error: 'Task not found' };
        }
        case 'lattice.search': {
          const results = await this.deps.search(args.query as string, { type: args.type as string | undefined });
          return { success: true, data: results };
        }
        case 'lattice.getSpec': {
          const spec = await this.deps.getSpec(args.name as string);
          return spec ? { success: true, data: spec } : { success: false, error: 'Spec not found' };
        }
        case 'lattice.listSpecs': {
          const specs = await this.deps.listSpecs();
          return { success: true, data: specs };
        }
        case 'lattice.addCheckpoint': {
          const ok = await this.deps.addCheckpoint(
            args.taskId as string,
            args.type as string,
            args.title as string,
            args.message as string,
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
