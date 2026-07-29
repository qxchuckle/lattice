/**
 * 源 profile 提供者：把握手 manifest 解析成 pipeline 策略与管线，并按源缓存
 *
 * 缓存语义与设计一致：manifest 冻结能力与政策，故 profile 可缓存；
 * 登录态变更走 `registry.rehandshake(id)` 后由 `invalidate(id)` 让本层重解析。
 *
 * lattice 侧的装配选择（与重构前行为等价）：
 * - listSkills：本地 skills + 源级 skills（源已原生注入自己的清单时不再枚举源级，避免双份）
 * - resolveCommandTemplate 不注入：lattice 的命令展开在结构化输入层（PromptComposer）完成，
 *   源级命令正文属源私有资产，宿主拿不到模板 → 不装 slash 展开 middleware（保持透传语义）
 */
import type { ISourceRegistry, ModelInfo } from '@qcqx/lattice-agent-protocol';
import {
  resolveSourceProfile,
  type SourceProfile,
  type SkillDescriptor,
  type PipelineNotice,
} from '@qcqx/lattice-agent-pipeline';

export interface SourceProfileProvider {
  /** 取该源的 profile（未解析则解析并缓存）；源未注册/未握手时返回 undefined */
  get(sourceId: string): SourceProfile | undefined;
  /** 失效缓存（rehandshake 后调用） */
  invalidate(sourceId?: string): void;
}

export interface SourceProfileProviderDeps {
  registry: ISourceRegistry;
  /** 宿主本地 skills（lattice 的 WorkflowEngine 提供） */
  listLocalSkills: () => SkillDescriptor[];
  /** 模型目录（guard 校验用）；缺省用 manifest 快照 */
  catalogOf?: (sourceId: string) => ModelInfo[] | undefined;
  /** 降级提示（图片省略/工具丢弃/指令内联）——宿主决定呈现 */
  onNotice?: (sourceId: string, notice: PipelineNotice) => void;
}

export function createSourceProfileProvider(
  deps: SourceProfileProviderDeps,
): SourceProfileProvider {
  const cache = new Map<string, SourceProfile>();

  const resolve = (sourceId: string): SourceProfile | undefined => {
    const manifest = deps.registry.getManifest(sourceId);
    if (!manifest) return undefined;
    const nativeSkills = manifest.capabilities.skills.nativeInjection;
    return resolveSourceProfile(manifest, {
      catalog: deps.catalogOf?.(sourceId) ?? manifest.modelsSnapshot,
      onNotice: (notice) => deps.onNotice?.(sourceId, notice),
      listSkills: async () => {
        const skills = new Map<string, SkillDescriptor>();
        for (const s of deps.listLocalSkills()) skills.set(s.name, s);
        // 源已把自己的 skills 列进 system prompt 时不再枚举源级，避免双份清单
        if (!nativeSkills) {
          const sourceSkills = await deps.registry.listResources(sourceId, { kinds: ['skill'] });
          for (const r of Array.isArray(sourceSkills) ? sourceSkills : []) {
            if (!skills.has(r.name))
              skills.set(r.name, { name: r.name, description: r.description });
          }
        }
        return [...skills.values()];
      },
    });
  };

  return {
    get(sourceId) {
      const cached = cache.get(sourceId);
      if (cached) return cached;
      const resolved = resolve(sourceId);
      if (resolved) cache.set(sourceId, resolved);
      return resolved;
    },
    invalidate(sourceId) {
      if (sourceId) cache.delete(sourceId);
      else cache.clear();
    },
  };
}
