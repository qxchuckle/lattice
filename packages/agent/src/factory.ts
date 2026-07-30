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
import { createSourcePermissionHandler } from './permission/source-permission.js';
import { ContextEngine, type ContextEngineConfig } from './context/context-engine.js';
import { createTaskContextMiddleware } from './context/task-context-middleware.js';
import {
  createSourceProfileProvider,
  type SourceProfileProvider,
} from './conversation/source-profiles.js';
import { WorkflowEngine, type WorkflowConfig } from './workflow/workflow-engine.js';

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
  /** 能力消费层：源能力 → 策略/管线/投影（壳层渲染与守卫均读此处） */
  profiles: SourceProfileProvider;
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
  const permission = new PermissionGuard(events);
  const context = new ContextEngine(events, deps.contextConfig);
  // 能力消费层：能力差异消化全交给 pipeline（skills 注入、图片降级、哨兵归一化、工具语义、守卫）；
  // lattice 专属的“价值类”注入（任务 PRD / spec / 进展）作为 extra middleware 接入同一管线
  const profiles = createSourceProfileProvider({
    registry: deps.sources.registry,
    listLocalSkills: () =>
      workflow.getSkills().map((s) => ({ name: s.name, description: s.description })),
    // 降级提示上总线：壳层订阅后呈现给用户（铁律——降级不得静默）
    onNotice: (sourceId, notice) =>
      events.emit('source:notice', { sourceId, code: notice.code, message: notice.message }),
    extraMiddlewares: (capabilities) => [
      createTaskContextMiddleware({
        engine: context,
        capabilities,
        onNotice: (message) => events.emit('source:notice', { code: 'task_context', message }),
      }),
    ],
  });
  const conversation = new ConversationController({
    session,
    sources: deps.sources,
    profiles,
    // 反向权限通道：pipeline 闸门（机制）+ PermissionGuard 规则与 UI 问询（策略）
    onPermissionRequest: createSourcePermissionHandler(permission),
    promptDeps: {
      resolveCommandTemplate: (name) => workflow.getCommandTemplate(name),
      ...deps.promptDeps,
    },
  });
  const tools = new ToolRegistry(events);

  return {
    events,
    session,
    conversation,
    tools,
    permission,
    sources: deps.sources,
    profiles,
    context,
    workflow,
    async dispose() {
      await deps.sources.dispose();
      await tools.disposeAll();
      events.removeAll();
    },
  };
}
