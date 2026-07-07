/**
 * 任务关联判断 — 依赖 lookup + identity
 *
 * 核心函数：
 * - isTaskAssociatedWithProject() — 判断任务是否关联项目（含虚拟合并扩展）
 */

import type { TaskMeta, ProjectMeta } from '../types';
import { resolveProjectIds, selectPrimaryId } from './identity';
import { getRelatedProjectIds, getProjectIdsFromDb } from './lookup';

/**
 * 判断任务是否关联到指定项目
 *
 * 匹配逻辑：
 * 1. 用 getRelatedProjectIds 扩展到所有虚拟合并的相关项目
 * 2. 收集所有相关项目的全部 IDs
 * 3. 检查 task.projects 中的每个 id 是否匹配
 * 4. 兼容无前缀 id：自动补 legacy: 前缀
 *
 * @param task 任务元数据
 * @param project 目标项目元数据
 * @returns true 如果任务关联到项目（含虚拟合并间接关联）
 */
export function isTaskAssociatedWithProject(task: TaskMeta, project: ProjectMeta): boolean {
  const taskProjectIds = new Set(task.projects ?? []);
  if (taskProjectIds.size === 0) return false;

  // 获取项目的所有 IDs（normalizeProjectMeta 已在读取时处理兼容性）
  const projectIds = project.ids;
  if (projectIds.length === 0) return false;

  // 虚拟合并：扩展到所有相关项目
  const primaryId = selectPrimaryId(projectIds) ?? projectIds[0];
  const relatedIds = getRelatedProjectIds(primaryId);

  // 收集所有相关项目的全部 IDs
  const allProjectIds = new Set<string>();
  for (const rid of relatedIds) {
    // 从 DB 获取相关项目的 IDs
    const dbIds = getProjectIdsFromDb(rid);
    for (const id of dbIds) {
      allProjectIds.add(id);
    }
  }
  // 也加入当前 project 的 IDs（可能 DB 中还没有）
  for (const id of projectIds) {
    allProjectIds.add(id);
  }

  // 兼容无前缀 id
  for (const id of taskProjectIds) {
    if (allProjectIds.has(id)) return true;
    if (!id.includes(':')) {
      if (allProjectIds.has(`legacy:${id}`)) return true;
    }
  }

  return false;
}

/**
 * 判断任务是否关联到指定项目 ID（不需读取 ProjectMeta）
 *
 * 简化版：直接用 projectId 查 DB 的 IDs
 */
export function isTaskAssociatedWithProjectId(task: TaskMeta, projectId: string): boolean {
  const taskProjectIds = new Set(task.projects ?? []);
  if (taskProjectIds.size === 0) return false;

  // 虚拟合并：扩展到所有相关项目
  const relatedIds = getRelatedProjectIds(projectId);

  // 收集所有相关项目的全部 IDs
  const allProjectIds = new Set<string>();
  for (const rid of relatedIds) {
    const dbIds = getProjectIdsFromDb(rid);
    for (const id of dbIds) {
      allProjectIds.add(id);
    }
  }

  // 兼容无前缀 id
  for (const id of taskProjectIds) {
    if (allProjectIds.has(id)) return true;
    if (!id.includes(':')) {
      if (allProjectIds.has(`legacy:${id}`)) return true;
    }
  }

  return false;
}
