import { randomBytes } from 'node:crypto';

/** Spec ID 前缀 */
export const SPEC_ID_PREFIX = 'spec-';

/** 8 位 ID 主体长度 */
const ID_BODY_LENGTH = 8;

/** Spec ID 完整格式正则：spec- + 8 位 base36（小写字母 + 数字） */
export const SPEC_ID_PATTERN = /^spec-[0-9a-z]{8}$/;

/**
 * 生成新的 spec ID。
 *
 * 格式：`spec-{8 位 base36 字符}`，例如 `spec-a3f9c2d1`。
 *
 * 设计：
 * - 不引入 nanoid 依赖（使用 node:crypto 内置）
 * - 8 位 base36 提供 36^8 ≈ 2.8 万亿组合，对单用户全部 spec 已足够
 * - 全部小写字母 + 数字，便于在文件系统、CLI、URL 中安全使用
 */
export function generateSpecId(): string {
  // 6 字节随机源，base36 输出取前 8 位即可
  const buf = randomBytes(6);
  // 把 6 字节转成大整数，再用 base36 编码
  let n = 0n;
  for (const b of buf) n = (n << 8n) + BigInt(b);
  let body = n.toString(36);
  // 不足 8 位左侧补 0，超过 8 位截断
  if (body.length < ID_BODY_LENGTH) body = body.padStart(ID_BODY_LENGTH, '0');
  if (body.length > ID_BODY_LENGTH) body = body.slice(-ID_BODY_LENGTH);
  return `${SPEC_ID_PREFIX}${body}`;
}

/** 检查字符串是否是合法的 spec ID 格式 */
export function isValidSpecId(value: unknown): value is string {
  return typeof value === 'string' && SPEC_ID_PATTERN.test(value);
}
