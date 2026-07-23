/**
 * Workflow Engine — / 命令、自动触发器、skill 加载
 * 将 lattice 工作流原生融入 Agent
 */
import type { SlashCommand, AgentEvent } from '../types.js';
import type { EventBus } from '../events/event-bus.js';

export interface WorkflowConfig {
  /** 自动化级别 */
  automation: 'full' | 'semi' | 'manual';
  /** skill 搜索目录 */
  skillDirs?: string[];
}

export interface TriggerResult {
  trigger: string;
  suggestion: string;
  autoExecute: boolean;
}

export interface SkillDefinition {
  name: string;
  description: string;
  triggers?: string[];
  template?: string;
  command?: string;
}

export class WorkflowEngine {
  private commands = new Map<string, SlashCommand>();
  private skills: SkillDefinition[] = [];
  private events: EventBus;
  private config: WorkflowConfig;

  constructor(events: EventBus, config?: WorkflowConfig) {
    this.events = events;
    this.config = { automation: 'semi', ...config };

    this.registerBuiltinCommands();
  }

  // ── / 命令 ──

  registerCommand(cmd: SlashCommand): void {
    this.commands.set(cmd.name, cmd);
  }

  getCommands(category?: string): SlashCommand[] {
    let cmds = [...this.commands.values()];
    if (category) cmds = cmds.filter((c) => c.category === category);
    return cmds;
  }

  async executeCommand(name: string, args: string[] = []): Promise<{ success: boolean; message: string }> {
    const cmd = this.commands.get(name);
    if (!cmd) return { success: false, message: `Unknown command: ${name}` };

    this.events.emit('workflow:command', { command: name, args });

    // TODO: Phase 1 实现具体命令执行逻辑
    return { success: true, message: `Command "${name}" executed (skeleton)` };
  }

  // ── 自动触发器 ──

  checkTriggers(event: AgentEvent, context: { fileEditCount?: number; turnCount?: number }): TriggerResult[] {
    if (this.config.automation === 'manual') return [];

    const triggers: TriggerResult[] = [];
    const autoExecute = this.config.automation === 'full';

    // 连续修改 3+ 文件 → 建议 checkpoint
    if (event.type === 'file_edit' && (context.fileEditCount ?? 0) >= 3) {
      triggers.push({
        trigger: 'checkpoint',
        suggestion: '已连续修改多个文件，建议打一个 milestone checkpoint',
        autoExecute,
      });
    }

    // 对话轮次过多 → 建议 compaction
    if ((context.turnCount ?? 0) > 20 && context.turnCount! % 10 === 0) {
      triggers.push({
        trigger: 'compaction',
        suggestion: '对话较长，建议压缩历史并打 note checkpoint 保存关键信息',
        autoExecute: false,
      });
    }

    return triggers;
  }

  // ── Skill 管理 ──

  async loadSkills(dirs: string[]): Promise<number> {
    // TODO: Phase 1 实现 skill 文件扫描和解析
    // 扫描 .md 文件，解析 frontmatter，注册为 skill
    this.events.emit('workflow:skills_loaded', { dirs, count: this.skills.length });
    return this.skills.length;
  }

  getSkills(): SkillDefinition[] {
    return this.skills;
  }

  // ── 内置命令 ──

  private registerBuiltinCommands(): void {
    const builtins: SlashCommand[] = [
      { name: '/lattice/task/start', description: '开始新任务', category: 'lattice', execute: 'workflow' },
      { name: '/lattice/task/design', description: '进入设计讨论', category: 'lattice', execute: 'workflow' },
      { name: '/lattice/task/archive', description: '归档任务', category: 'lattice', execute: 'workflow' },
      { name: '/lattice/context', description: '获取项目上下文', category: 'lattice', execute: 'tool', toolName: 'getTaskContext' },
      { name: '/lattice/spec/list', description: '列出规范', category: 'lattice', execute: 'tool', toolName: 'getSpec' },
      { name: '/lattice/search', description: '跨项目搜索', category: 'lattice', execute: 'tool', toolName: 'searchHistory' },
      { name: '/agent/switch', description: '切换 Agent', category: 'agent', execute: 'workflow' },
      { name: '/branch/new', description: '新建分支', category: 'branch', execute: 'workflow' },
      { name: '/branch/merge', description: '合并分支', category: 'branch', execute: 'workflow' },
      { name: '/export', description: '导出对话树', category: 'system', execute: 'workflow' },
    ];
    for (const cmd of builtins) this.commands.set(cmd.name, cmd);
  }
}
