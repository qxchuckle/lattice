import { t } from '../t';
import type { ViewSearchPreviewTarget, ViewSearchTargetConfig } from './view-search-logic';

/**
 * 三目标搜索配置（命令 / picker / 预览服务共用；含 t() 文案，故与纯逻辑分文件）。
 * FTS 类型与 id 收集口径需与全局搜索（commands/search.ts）保持一致。
 */
export const VIEW_SEARCH_TARGET_CONFIG: Record<ViewSearchPreviewTarget, ViewSearchTargetConfig> = {
  tasks: {
    inputTitle: t('Search Tasks'),
    ftsTypes: ['task', 'prd', 'design', 'checkpoint'],
    collectIds: (row) => [row.taskId].filter((id): id is string => Boolean(id)),
  },
  specs: {
    inputTitle: t('Search Specs'),
    ftsTypes: ['spec'],
    collectIds: (row) => [row.specId].filter((id): id is string => Boolean(id)),
  },
  projects: {
    inputTitle: t('Search Projects'),
    ftsTypes: ['project'],
    collectIds: (row) => row.projectIds.filter((id) => Boolean(id)),
  },
};
