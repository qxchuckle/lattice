/**
 * Workflow Engine — / 命令、自动触发器、skill 加载
 * 将 lattice 工作流原生融入 Agent
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SourceResourceInfo } from '@qcqx/lattice-agent-protocol';
import type { SlashCommand, AgentEvent } from '../types.js';
import type { EventBus } from '../events/event-bus.js';
import { scanLocalCommands, stripFrontmatter } from './command-scan.js';
import type { LocalCommand } from './command-scan.js';

export interface WorkflowConfig {
  /** 自动化级别 */
  automation: 'full' | 'semi' | 'manual';
  /** skill 搜索目录 */
  skillDirs?: string[];
  /** 本地命令模板目录（缺省 ~/.lattice/agent/commands；项目级由 loadLocalCommands(cwd) 追加） */
  commandDirs?: string[];
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

/**
 * skills 可用清单 → system prompt 追加段（渐进披露：只给 name+description，正文由模型自行 read）。
 * 格式对齐 Agent Skills 标准（与 pi formatSkillsForPrompt 同构）。空清单返回 undefined（不追加）。
 */
export function formatSkillsAppendix(
  skills: Array<{ name: string; description?: string }>,
): string | undefined {
  if (skills.length === 0) return undefined;
  const lines = skills.map((s) => `- name: ${s.name}\n  description: ${s.description ?? ''}`);
  return [
    'The following skills provide specialized instructions for specific tasks.',
    'Use the read tool to load a skill file when the task matches its description.',
    '',
    '<available_skills>',
    ...lines,
    '</available_skills>',
  ].join('\n');
}

export class WorkflowEngine {
  private commands = new Map<string, SlashCommand>();
  private skills: SkillDefinition[] = [];
  private events: EventBus;
  private config: WorkflowConfig;
  /** 扫描到的本地命令模板（name → 命令；项目级覆盖用户级） */
  private localCommands = new Map<string, LocalCommand>();

  constructor(events: EventBus, config?: WorkflowConfig) {
    this.events = events;
    this.config = { automation: 'semi', ...config };

    this.registerBuiltinCommands();
  }

  // ── 本地命令模板（origin='local'，PromptComposer 展开用） ──

  /**
   * 扫描本地命令目录：用户级（config.commandDirs，缺省 ~/.lattice/agent/commands）
   * + 项目级（<cwd>/.lattice/commands）。同名后者覆盖前者。
   */
  loadLocalCommands(cwd?: string): number {
    this.localCommands.clear();
    const userDirs = this.config.commandDirs ?? [join(homedir(), '.lattice', 'agent', 'commands')];
    const roots: Array<{ dir: string; scope: 'user' | 'project' }> = userDirs.map((dir) => ({
      dir,
      scope: 'user' as const,
    }));
    if (cwd) roots.push({ dir: join(cwd, '.lattice', 'commands'), scope: 'project' });
    for (const { dir, scope } of roots) {
      for (const cmd of scanLocalCommands(dir, scope)) {
        this.localCommands.set(cmd.name, cmd);
      }
    }
    this.events.emit('workflow:commands_loaded', { count: this.localCommands.size });
    return this.localCommands.size;
  }

  /** 本地资源列表（命令 + skill），与源级 listResources 合并后供壳层菜单 */
  listLocalResources(): SourceResourceInfo[] {
    const out: SourceResourceInfo[] = [...this.localCommands.values()];
    for (const s of this.skills) {
      out.push({ kind: 'skill', name: s.name, description: s.description });
    }
    return out;
  }

  /** 命令模板正文（去 frontmatter）；null = 非本地命令 */
  async getCommandTemplate(name: string): Promise<string | null> {
    const cmd = this.localCommands.get(name);
    if (!cmd) return null;
    try {
      return stripFrontmatter(await readFile(cmd.templatePath, 'utf-8')).trim();
    } catch {
      return null;
    }
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

  async executeCommand(
    name: string,
    args: string[] = [],
  ): Promise<{ success: boolean; message: string }> {
    const cmd = this.commands.get(name);
    if (!cmd) return { success: false, message: `Unknown command: ${name}` };

    this.events.emit('workflow:command', { command: name, args });

    // TODO: Phase 1 实现具体命令执行逻辑
    return { success: true, message: `Command "${name}" executed (skeleton)` };
  }

  // ── 自动触发器 ──

  checkTriggers(
    event: AgentEvent,
    context: { fileEditCount?: number; turnCount?: number },
  ): TriggerResult[] {
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
      {
        name: '/lattice/task/start',
        description: '开始新任务',
        category: 'lattice',
        execute: 'workflow',
      },
      {
        name: '/lattice/task/design',
        description: '进入设计讨论',
        category: 'lattice',
        execute: 'workflow',
      },
      {
        name: '/lattice/task/archive',
        description: '归档任务',
        category: 'lattice',
        execute: 'workflow',
      },
      {
        name: '/lattice/context',
        description: '获取项目上下文',
        category: 'lattice',
        execute: 'tool',
        toolName: 'getTaskContext',
      },
      {
        name: '/lattice/spec/list',
        description: '列出规范',
        category: 'lattice',
        execute: 'tool',
        toolName: 'getSpec',
      },
      {
        name: '/lattice/search',
        description: '跨项目搜索',
        category: 'lattice',
        execute: 'tool',
        toolName: 'searchHistory',
      },
      { name: '/agent/switch', description: '切换 Agent', category: 'agent', execute: 'workflow' },
      { name: '/branch/new', description: '新建分支', category: 'branch', execute: 'workflow' },
      { name: '/branch/merge', description: '合并分支', category: 'branch', execute: 'workflow' },
      { name: '/export', description: '导出对话树', category: 'system', execute: 'workflow' },
    ];
    for (const cmd of builtins) this.commands.set(cmd.name, cmd);
  }
}
