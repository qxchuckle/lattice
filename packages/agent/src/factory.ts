/**
 * 工厂函数 — 组装所有模块为完整的 Lattice Agent 实例
 * 依赖注入模式，便于测试和替换
 */
import type { AgentSourceInstance } from '@qcqx/lattice-agent-source';
import { EventBus } from './events/event-bus.js';
import { SessionManager, type SessionStorage } from './session/session-manager.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { PermissionGuard } from './permission/permission-guard.js';
import { ContextEngine, type ContextEngineConfig } from './context/context-engine.js';
import { WorkflowEngine, type WorkflowConfig } from './workflow/workflow-engine.js';

export interface LatticeAgentDeps {
  storage: SessionStorage;
  /** agent-source 实例（由上层通过 createAgentSource 创建后注入） */
  sources: AgentSourceInstance;
  contextConfig?: ContextEngineConfig;
  workflowConfig?: WorkflowConfig;
}

export interface LatticeAgent {
  events: EventBus;
  session: SessionManager;
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
  const tools = new ToolRegistry(events);
  const permission = new PermissionGuard(events);
  const context = new ContextEngine(events, deps.contextConfig);
  const workflow = new WorkflowEngine(events, deps.workflowConfig);

  return {
    events,
    session,
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
