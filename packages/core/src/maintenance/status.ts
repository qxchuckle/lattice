import { statSync } from 'node:fs';
import { getLatticeRoot, getDbPath } from '../paths';
import { getUsername, readResolvedConfig, isInitialized } from '../config';
import { listProjects } from '../project';
import { listTasks } from '../task';
import { isGitInitialized } from './git-ops';

/** 全局状态信息 */
export interface GlobalStatus {
  /** Lattice 根目录路径 */
  latticeRoot: string;
  /** 当前用户名 */
  username: string;
  /** 项目数 */
  projectCount: number;
  /** 任务数 */
  taskCount: number;
  /** 活跃任务数 */
  activeTaskCount: number;
  /** 数据库大小（KB） */
  dbSizeKB: number;
  /** 数据库路径 */
  dbPath: string;
  /** Git 是否启用 */
  gitEnabled: boolean;
  /** 扫描目录 */
  scanDirs: string[];
}

/** 获取 Lattice 全局状态。
 *  调用方负责 initDb/closeDb。 */
export async function getGlobalStatus(): Promise<GlobalStatus | null> {
  if (!(await isInitialized())) return null;

  const username = await getUsername();
  // 不在此处 initDb/closeDb，由调用方管理 DB 生命周期

  const config = await readResolvedConfig();
  const projects = listProjects(username);
  const tasks = await listTasks(username);
  const activeTasks = tasks.filter((t) => t.status === 'in_progress' || t.status === 'planning');

  let dbSize = 0;
  const dbPath = getDbPath();
  try {
    dbSize = statSync(dbPath).size;
  } catch {
    // 数据库文件可能不存在
  }

  const gitEnabled = await isGitInitialized();

  return {
    latticeRoot: getLatticeRoot(),
    username,
    projectCount: projects.length,
    taskCount: tasks.length,
    activeTaskCount: activeTasks.length,
    dbSizeKB: Math.round(dbSize / 1024),
    dbPath,
    gitEnabled,
    scanDirs: config?.scanDirs ?? [],
  };
}
