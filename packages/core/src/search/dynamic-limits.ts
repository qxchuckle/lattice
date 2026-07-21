import { getDocCountByType, getDb } from '../db';

/**
 * 动态搜索 limit 计算：基于对数缩放公式 + 分类参数。
 *
 * 公式：max(MIN_FLOOR[type], ceil(K[type] * ln(1 + docCount[type])))
 * 无上限保护——对数增长天然极缓。
 */

/** 每类别的缩放系数 K */
const K: Record<string, number> = {
  spec: 3,
  task: 2,
  project: 2,
  relation: 1.5,
};

/** 每类别的最小保底值 */
const MIN_FLOOR: Record<string, number> = {
  spec: 3,
  task: 3,
  project: 2,
  relation: 2,
};

export interface DynamicLimits {
  spec: number;
  task: number;
  project: number;
  relation: number;
}

/** 模块级缓存 + 关联的 db 实例引用（db 重连后自动失效） */
let cachedLimits: DynamicLimits | null = null;
let cachedDbRef: unknown = null;

/**
 * 计算各类别的动态搜索 limit。
 * 同一 DB 连接周期内缓存结果；db 关闭/重连后自动重新计算。
 */
export function computeDynamicLimits(): DynamicLimits {
  // 检测 db 实例是否变化（closeDb → initDb 后引用不同）
  let currentDbRef: unknown;
  try {
    currentDbRef = getDb();
  } catch {
    // db 未打开，返回保底值
    return {
      spec: MIN_FLOOR.spec,
      task: MIN_FLOOR.task,
      project: MIN_FLOOR.project,
      relation: MIN_FLOOR.relation,
    };
  }

  if (cachedLimits && cachedDbRef === currentDbRef) return cachedLimits;

  const counts = getDocCountByType();

  const compute = (type: string): number => {
    const docCount = counts[type] ?? 0;
    const k = K[type] ?? 2;
    const floor = MIN_FLOOR[type] ?? 3;
    return Math.max(floor, Math.ceil(k * Math.log(1 + docCount)));
  };

  cachedLimits = {
    spec: compute('spec'),
    task: compute('task'),
    project: compute('project'),
    relation: compute('relation'),
  };
  cachedDbRef = currentDbRef;

  return cachedLimits;
}
