/**
 * 统一时间工具 — Lattice 全局时间格式收口
 *
 * 规则：
 * - 所有元数据时间戳字段（created / updated / time / firstReadAt / addedAt 等）使用 ISO 8601 完整格式
 * - 仅在生成"人类可读 ID 前缀"时使用 date-only 格式（如 task ID、trash ID）
 */

/**
 * 当前时刻的完整 ISO 8601 时间戳（用于所有元数据字段）
 *
 * 格式：`2026-06-05T03:43:31.574Z`
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * 当前日期字符串（仅用于 ID 生成中的日期前缀，不用于元数据字段）
 *
 * 格式：`2026-06-05`
 */
export function todayDateForId(): string {
  return new Date().toISOString().slice(0, 10);
}
