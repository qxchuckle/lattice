/**
 * 节点 id 工具：路径式 id 在重复段上追加 `~n` 后缀以保证唯一
 * （reveal 依赖 id → handle 的稳定性，重复 id 会导致句柄冲突）。
 */
export function uniqueNodeId(base: string, seen: Set<string>): string {
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let counter = 2;
  while (seen.has(`${base}~${counter}`)) counter += 1;
  const id = `${base}~${counter}`;
  seen.add(id);
  return id;
}
