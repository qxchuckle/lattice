/**
 * 工厂函数 — 组装所有模块为完整的 Lattice Agent 实例
 * 依赖注入模式，便于测试和替换
 */
import type { AgentSourceInstance } from '@qcqx/lattice-agent-source';
import { EventBus } from './events/event-bus.js';
import { SessionManager, type SessionStorage } from './session/session-manager.js';
import { ConversationController } from './conversation/conversation-controller.js';
import type { PromptComposerDeps } from './prompt/prompt-composer.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { PermissionGuard } from './permission/permission-guard.js';
import { ContextEngine, type ContextEngineConfig } from './context/context-engine.js';
import {
  WorkflowEngine,
  formatSkillsAppendix,
  type WorkflowConfig,
} from './workflow/workflow-engine.js';

export interface LatticeAgentDeps {
  storage: SessionStorage;
  /** agent-source 实例（由上层通过 createAgentSource 创建后注入） */
  sources: AgentSourceInstance;
  contextConfig?: ContextEngineConfig;
  workflowConfig?: WorkflowConfig;
  /** 结构化输入展开依赖：resolveRef 由壳层注入（spec/task 读取需 core）；
   *  resolveCommandTemplate 缺省接 WorkflowEngine 本地命令模板 */
  promptDeps?: PromptComposerDeps;
}

export interface LatticeAgent {
  events: EventBus;
  session: SessionManager;
  /** 会话编排核心（send/continue/retry/undo/delete/fork/abort） */
  conversation: ConversationController;
  tools: ToolRegistry;
  permission: PermissionGuard;
  /** 统一源抽象实例（替代原 AgentCore） */
  sources: AgentSourceInstance;
  context: ContextEngine;
  workflow: WorkflowEngine;
  dispose(): Promise<void>;
}

/** 创建完整 Lattice Agent 实例 */
export function createLatticeAgent(deps: LatticeAgentDeps): LatticeAgent {
  const events = new EventBus();
  const session = new SessionManager(deps.storage);
  const workflow = new WorkflowEngine(events, deps.workflowConfig);
  workflow.loadLocalCommands(); // 用户级命令模板；项目级由上层带 cwd 重扫
  const conversation = new ConversationController({
    session,
    sources: deps.sources,
    promptDeps: {
      resolveCommandTemplate: (name) => workflow.getCommandTemplate(name),
      ...deps.promptDeps,
    },
    // skills 可用清单注入（本地 + 源级去重合并）：模型知道有哪些 skill 可调用，正文按需加载
    systemPromptAppendix: async (sourceId) => {
      const skills = new Map<string, { name: string; description?: string }>();
      for (const s of workflow.getSkills()) {
        skills.set(s.name, { name: s.name, description: s.description });
      }
      // 源已自行注入 skills 清单（如 Pi buildSystemPrompt）时不重复拉取源级 skills，避免双重清单
      // 能力读 manifest（握手 verified），未握手退 describe 的 declared
      const registry = deps.sources.registry;
      const caps =
        registry.getManifest(sourceId)?.capabilities ??
        registry.getSource(sourceId)?.describe().capabilities;
      if (!caps?.skills.nativeInjection) {
        const sourceSkills = await registry.listResources(sourceId, {
          kinds: ['skill'],
        });
        for (const r of Array.isArray(sourceSkills) ? sourceSkills : []) {
          if (!skills.has(r.name)) skills.set(r.name, { name: r.name, description: r.description });
        }
      }
      return formatSkillsAppendix([...skills.values()]);
    },
  });
  const tools = new ToolRegistry(events);
  const permission = new PermissionGuard(events);
  const context = new ContextEngine(events, deps.contextConfig);

  return {
    events,
    session,
    conversation,
    tools,
    permission,
    sources: deps.sources,
    context,
    workflow,
    async dispose() {
      await deps.sources.dispose();
      await tools.disposeAll();
      events.removeAll();
    },
  };
}
