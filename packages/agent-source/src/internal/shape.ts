/**
 * 未知形状的受检窥探（SDK 原始数据 / dot-path 走查共用）
 *
 * 源层不可避免要处理 SDK 的松散数据，但「窥探」应当是**判定**而非断言：
 * `isRecord` 让每个访问点都先过类型守卫，避免各处散落 `as Record<string, unknown>`。
 */

/** 是否为普通对象（非 null、非数组）——数组不算记录，避免 `obj[0]` 被当字段读 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 取字符串字段（缺失/非字符串/空串 → undefined） */
export function stringField(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === 'string' && value ? value : undefined;
}

/** 取记录字段（缺失/非对象 → 空对象，调用方无需再判空） */
export function recordField(source: unknown, key: string): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const value = source[key];
  return isRecord(value) ? value : {};
}
