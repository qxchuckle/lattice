/**
 * 项目节点彩色图标：按项目 ID 稳定映射到主题图表色（六色轮转），
 * 让列表里的项目行可以一眼区分；颜色跟随主题自适应（浅/深主题均有定义），
 * 且同一项目跨会话颜色恒定（FNV-1a 哈希，非随机）。
 *
 * 纯逻辑模块（vscode-free）：调用方自行组装
 * `new vscode.ThemeIcon('project', new vscode.ThemeColor(projectIconColor(id)))`。
 */

/** 主题图表色板（`charts.*`），顺序即轮转顺序。 */
export const PROJECT_ICON_COLORS = [
  'charts.blue',
  'charts.green',
  'charts.orange',
  'charts.purple',
  'charts.red',
  'charts.yellow',
] as const;

/** FNV-1a 32 位稳定哈希 → 色板索引。 */
export function projectIconColorIndex(
  projectId: string,
  paletteSize: number = PROJECT_ICON_COLORS.length,
): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < projectId.length; i += 1) {
    hash ^= projectId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % paletteSize;
}

/** 项目 ID → 主题色 ID（`vscode.ThemeColor` 构造入参）。 */
export function projectIconColor(projectId: string): string {
  return PROJECT_ICON_COLORS[projectIconColorIndex(projectId)];
}
