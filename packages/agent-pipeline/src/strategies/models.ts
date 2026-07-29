/**
 * tools 注入策略表 + models 选择策略表
 *
 * tools：宿主工具怎么送进源（进程内函数 / MCP 桥 / 送不进去）
 * models：模型 ID 合法性判定口径（目录内 / 自由 / 混合）——UI 与接口用同一判定
 */
import type {
  ToolInjectionCapability,
  ModelsCapability,
  ModelInfo,
} from '@qcqx/lattice-agent-protocol';

// ── tools ──

export type ToolInjectionShape = 'in-process' | 'mcp-bridge' | 'none';

export function toolInjectionShape(cap: ToolInjectionCapability): ToolInjectionShape {
  return cap === false ? 'none' : cap;
}

export type ToolInjectionPlan =
  /** 直接随会话装配（进程内函数调用，零序列化开销） */
  | { kind: 'direct'; transport: 'in-process' }
  /** 经 MCP 桥装配：参数需 JSON 可序列化，跨进程有延迟 */
  | { kind: 'direct'; transport: 'mcp-bridge' }
  /** 送不进去：宿主工具须丢弃（带 notice），或改用源内置工具完成同等目的 */
  | { kind: 'drop'; capabilityPath: 'tools.injection'; notice: string };

const TOOL_INJECTION_PLANNERS: Record<ToolInjectionShape, () => ToolInjectionPlan> = {
  'in-process': () => ({ kind: 'direct', transport: 'in-process' }),
  'mcp-bridge': () => ({ kind: 'direct', transport: 'mcp-bridge' }),
  none: () => ({
    kind: 'drop',
    capabilityPath: 'tools.injection',
    notice: '该源不支持注入宿主工具，本轮仅使用源内置工具',
  }),
};

export function planToolInjection(cap: ToolInjectionCapability): ToolInjectionPlan {
  return TOOL_INJECTION_PLANNERS[toolInjectionShape(cap)]();
}

// ── models ──

export type ModelSelectionShape = ModelsCapability['policy'];

export type ModelValidation =
  | { ok: true; resolved: ModelInfo | null }
  | { ok: false; capabilityPath: 'models.policy'; reason: string };

/**
 * 目录内查找（catalog/hybrid 用）。catalog 为空视为「目录未就绪」——
 * 不能据此判违规（可能是未认证/离线），放行并返回 resolved:null。
 */
function findInCatalog(catalog: ModelInfo[], modelId: string): ModelInfo | null {
  return catalog.find((m) => m.id === modelId) ?? null;
}

const MODEL_VALIDATORS: Record<
  ModelSelectionShape,
  (modelId: string, catalog: ModelInfo[]) => ModelValidation
> = {
  catalog: (modelId, catalog) => {
    if (catalog.length === 0) return { ok: true, resolved: null };
    const found = findInCatalog(catalog, modelId);
    return found
      ? { ok: true, resolved: found }
      : {
          ok: false,
          capabilityPath: 'models.policy',
          reason: `该源仅支持目录内模型，未知模型：${modelId}`,
        };
  },
  open: (modelId, catalog) => ({ ok: true, resolved: findInCatalog(catalog, modelId) }),
  hybrid: (modelId, catalog) => ({ ok: true, resolved: findInCatalog(catalog, modelId) }),
};

export function validateModel(
  cap: ModelsCapability,
  modelId: string,
  catalog: ModelInfo[] = [],
): ModelValidation {
  return MODEL_VALIDATORS[cap.policy](modelId, catalog);
}

/** UI 是否允许自定义模型输入（catalog 策略下只能下拉选择） */
export function allowsCustomModelId(cap: ModelsCapability): boolean {
  return cap.policy !== 'catalog';
}
