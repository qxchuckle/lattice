/**
 * Context Engine — 上下文构建、注入、压缩
 * 分层架构：tools → specs → task → history
 */
import type { BuiltContext, ContextLayer } from '../types.js';
import type { EventBus } from '../events/event-bus.js';

export interface ContextEngineConfig {
  /** 最大上下文 token 预算 */
  maxTokens?: number;
  /** 是否自动注入任务上下文 */
  autoInjectTask?: boolean;
  /** 是否自动注入 spec */
  autoInjectSpecs?: boolean;
}

export interface ContextSource {
  /** 获取任务 PRD 摘要 */
  getTaskSummary(taskId: string): Promise<string | null>;
  /** 获取相关 spec 列表 */
  getRelevantSpecs(taskId: string, limit?: number): Promise<{ name: string; content: string }[]>;
  /** 获取最近 checkpoint */
  getRecentCheckpoints(taskId: string, limit?: number): Promise<string[]>;
  /** 获取项目路径列表 */
  getProjectPaths(taskId: string): Promise<string[]>;
}

export class ContextEngine {
  private events: EventBus;
  private config: ContextEngineConfig;
  private source: ContextSource | null = null;

  constructor(events: EventBus, config?: ContextEngineConfig) {
    this.events = events;
    this.config = {
      maxTokens: 128_000,
      autoInjectTask: true,
      autoInjectSpecs: true,
      ...config,
    };
  }

  /** 注入数据源（由调用方提供 lattice-core 实现） */
  setSource(source: ContextSource): void {
    this.source = source;
  }

  /** 构建完整上下文 */
  async buildContext(opts: {
    taskId?: string;
    model?: string;
    historyTokens?: number;
  }): Promise<BuiltContext> {
    const layers: ContextLayer[] = [];
    let totalTokens = 0;
    const maxTokens = this.config.maxTokens ?? 128_000;

    // Layer 2: 项目规范（system prompt 常驻）
    if (opts.taskId && this.source && this.config.autoInjectSpecs) {
      const specs = await this.source.getRelevantSpecs(opts.taskId, 3);
      if (specs.length > 0) {
        const content = specs.map((s) => `## ${s.name}\n${s.content}`).join('\n\n');
        const tokens = this.estimateTokens(content);
        layers.push({ layer: 'specs', content, tokens });
        totalTokens += tokens;
      }
    }

    // Layer 3: 任务上下文
    if (opts.taskId && this.source && this.config.autoInjectTask) {
      const parts: string[] = [];

      const summary = await this.source.getTaskSummary(opts.taskId);
      if (summary) parts.push(`## 任务 PRD\n${summary}`);

      const checkpoints = await this.source.getRecentCheckpoints(opts.taskId, 5);
      if (checkpoints.length > 0) parts.push(`## 最近进展\n${checkpoints.join('\n')}`);

      const paths = await this.source.getProjectPaths(opts.taskId);
      if (paths.length > 0) parts.push(`## 关联项目路径\n${paths.join('\n')}`);

      if (parts.length > 0) {
        const content = parts.join('\n\n');
        const tokens = this.estimateTokens(content);
        layers.push({ layer: 'task', content, tokens });
        totalTokens += tokens;
      }
    }

    // 构建 system prompt
    const systemPrompt = this.buildSystemPrompt(layers);

    return { systemPrompt, layers, totalTokens, maxTokens };
  }

  /** 压缩历史（TODO: Phase 1 集成 Pi compaction） */
  async compact(historyContent: string, targetTokens: number): Promise<string> {
    // 骨架：直接截断。实际实现将调用 LLM 做语义压缩
    const maxChars = targetTokens * 4;
    if (historyContent.length <= maxChars) return historyContent;
    return historyContent.slice(-maxChars);
  }

  private buildSystemPrompt(layers: ContextLayer[]): string {
    const parts: string[] = [
      '你是 Lattice 工作台的内置 AI Agent。你理解任务上下文、遵循项目规范、能操作文件和终端。',
    ];
    for (const layer of layers) {
      parts.push(layer.content);
    }
    return parts.join('\n\n---\n\n');
  }

  private estimateTokens(text: string): number {
    // 粗略估算：1 token ≈ 4 字符（英文）/ 2 字符（中文）
    return Math.ceil(text.length / 3);
  }
}
