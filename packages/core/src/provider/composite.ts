import {
  readSyncDomains,
  domainHashOf,
  mirrorDirOf,
  normalizeDomainConfig,
} from '../sync/domain-config';
import { createLocalSource } from './local-source';
import { createDomainSource, DegradedSourceError } from './domain-source';
import type { DataSource, SpecView, TaskView, ProjectView, SourceId } from './types';

/**
 * CompositeProvider：合并策略唯一锚点。
 *
 * 遮蔽规则（本地最高 > 域按配置数组序；先入 map 者胜）：
 *   spec = namespace（scope:username:contractId:relativePath）
 *   task = username:taskId
 *   project = username:contractId（本地无契约 ID 的项目不参与跨源遮蔽，独立可见）
 *
 * use 档位双视图：knowledgeView（use != off 全部域）/ constraintView（仅 trusted）。
 * G1 降级：单域读取失败（含 G2 rebase 跳过）→ 跳过该域 + 收集警告，整体不炸。
 */

export interface MergedView {
  specs: SpecView[];
  tasks: TaskView[];
  projects: ProjectView[];
  /** 被遮蔽的域条目（遮蔽可发现性：来源 + 被谁遮蔽） */
  shadowed: ShadowedEntry[];
  /** 本轮降级跳过的域（G1/G2） */
  degraded: string[];
}

export interface ShadowedEntry {
  namespace: string;
  lostSource: SourceId;
  wonSource: SourceId;
  /** 被遮蔽的完整条目（供 --source 直读被遮蔽版本） */
  entry: SpecView;
}

export interface CompositeResult extends MergedView {
  /** 来源标注辅助的 label 映射（hash → label） */
  labels: Map<string, string>;
}

export async function createComposite(username: string): Promise<{
  sources: DataSource[];
  knowledgeView(): Promise<CompositeResult>;
  constraintView(): Promise<CompositeResult>;
  sourceLabels(): Promise<Map<string, string>>;
}> {
  const domains = await readSyncDomains();
  const labels = new Map<string, string>();
  const sources: DataSource[] = [createLocalSource(username)];
  for (const raw of domains) {
    const d = normalizeDomainConfig(raw);
    const hash = domainHashOf(d);
    if (d.label) labels.set(hash, d.label);
    sources.push(createDomainSource({ domain: d, domainHash: hash, mirrorDir: mirrorDirOf(d) }));
  }

  async function merge(include: (s: DataSource) => boolean): Promise<CompositeResult> {
    const specMap = new Map<string, SpecView>();
    const taskMap = new Map<string, TaskView>();
    const projectMap = new Map<string, ProjectView>();
    const shadowed: ShadowedEntry[] = [];
    const degraded: string[] = [];

    // sources 顺序 = local 在首 + 域按配置数组序 → 先入者胜即优先级语义
    for (const source of sources) {
      if (!include(source)) continue;
      try {
        for (const v of await source.listSpecs()) {
          if (specMap.has(v.namespace)) {
            shadowed.push({
              namespace: v.namespace,
              lostSource: v.source,
              wonSource: specMap.get(v.namespace)!.source,
              entry: v,
            });
          } else {
            specMap.set(v.namespace, v);
          }
        }
        for (const v of await source.listTasks()) {
          const key = `${v.username}:${v.task.id}`;
          if (!taskMap.has(key)) taskMap.set(key, v);
        }
        for (const v of await source.listProjects()) {
          // 无契约 ID 的项目（本地 legacy-only）不参与跨源遮蔽：键加 source 前缀独立可见
          const key = v.contractId
            ? `${v.username}:${v.contractId}`
            : `${v.source}:${v.username}:${v.project.id}`;
          if (v.contractId && projectMap.has(key)) {
            // 本地遮蔽域（不记录域遮蔽本地的方向性条目，保持 shadowed 只标注"域版本未生效"）
          } else {
            projectMap.set(key, v);
          }
        }
      } catch (err) {
        if (err instanceof DegradedSourceError || source.kind === 'domain') {
          degraded.push(err instanceof DegradedSourceError ? err.message : (err as Error).message);
        } else {
          throw err; // local 源失败是真故障，向上抛
        }
      }
    }

    return {
      specs: [...specMap.values()],
      tasks: [...taskMap.values()],
      projects: [...projectMap.values()],
      shadowed,
      degraded,
      labels,
    };
  }

  return {
    sources,
    knowledgeView: () => merge((s) => s.use !== 'off'),
    constraintView: () => merge((s) => s.kind === 'local' || s.use === 'trusted'),
    sourceLabels: async () => labels,
  };
}
