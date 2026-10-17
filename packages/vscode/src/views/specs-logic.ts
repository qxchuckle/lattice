/**
 * 规范视图的纯逻辑工具。
 *
 * 树节点 id 在 VS Code 里要求全树唯一（重复会触发
 * "Element with id ... has already been registered" 并让分组渲染为空）。
 * 数据侧已多层去重（core 虚拟合并 / services 采集），这里再做一层兜底：
 * 不同物理文件可能共享同一个行 id（如均无 frontmatter id 时回退 fileName），
 * 此时追加 `~N` 后缀保证唯一——`itemFromId` 解析时会剥离后缀，reveal 不受影响。
 */

/** 生成全树唯一的节点 id：冲突时追加 `~2`、`~3`…（首见保持原样）。 */
export function uniqueSuffixId(baseId: string, seen: Set<string>): string {
  if (!seen.has(baseId)) {
    seen.add(baseId);
    return baseId;
  }
  let n = 2;
  while (seen.has(`${baseId}~${n}`)) n += 1;
  const id = `${baseId}~${n}`;
  seen.add(id);
  return id;
}
