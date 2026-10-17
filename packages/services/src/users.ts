/** 用户域：当前用户与用户列表。 */
import { getUsername, listAllUsernames } from '@qcqx/lattice-core';

/** 当前用户（读 config-local.json；未初始化时抛错）。 */
export async function currentUsername(): Promise<string> {
  return getUsername();
}

/** 所有用户（DB 索引优先，失败回退 users 目录扫描）。 */
export async function listUsers(): Promise<string[]> {
  return listAllUsernames();
}
