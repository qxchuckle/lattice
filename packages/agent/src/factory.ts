/**
 * 工厂函数 — 组装所有模块为完整的 Lattice Agent 实例
 * 依赖注入模式，便于测试和替换
 */
import { EventBus } from './events/event-bus.js';
import { SessionManager, type SessionStorage } from './session/session-manager.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { PermissionGuard } from './permission/permission-guard.js';
import { AgentCore, type AgentCoreConfig } from './core/agent-core.js';
import { ContextEngine, type ContextEngineConfig } from './context/context-engine.js';
import { WorkflowEngine, type WorkflowConfig } from './workflow/workflow-engine.js';

export interface LatticeAgentDeps {
  storage: SessionStorage;
  agentConfig?: AgentCoreConfig;
  contextConfig?: ContextEngineConfig;
  workflowConfig?: WorkflowConfig;
}

export interface LatticeAgent {
  events: EventBus;
  session: SessionManager;
  tools: ToolRegistry;
  permission: PermissionGuard;
  core: AgentCore;
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
  const core = new AgentCore(events, tools, permission, deps.agentConfig);
  const context = new ContextEngine(events, deps.contextConfig);
  const workflow = new WorkflowEngine(events, deps.workflowConfig);

  return {
    events,
    session,
    tools,
    permission,
    core,
    context,
    workflow,
    async dispose() {
      await tools.disposeAll();
      events.removeAll();
    },
  };
}
