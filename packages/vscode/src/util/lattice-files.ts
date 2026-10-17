import * as path from 'node:path';

/** ~/.lattice 下的确定性路径构造（只读使用；写操作一律经 CLI）。 */

export function taskDir(root: string, username: string, taskId: string): string {
  return path.join(root, 'users', username, 'tasks', taskId);
}

export function taskDocPath(
  root: string,
  username: string,
  taskId: string,
  doc: 'prd' | 'design' | 'progress',
): string {
  const name = doc === 'prd' ? 'prd.md' : doc === 'design' ? 'design.md' : 'progress.yaml';
  return path.join(taskDir(root, username, taskId), name);
}

export function projectDir(root: string, username: string, projectId: string): string {
  return path.join(root, 'users', username, 'projects', projectId);
}

export function projectProfilePath(root: string, username: string, projectId: string): string {
  return path.join(projectDir(root, username, projectId), 'profile', 'summary.md');
}

/** web 服务 PID/端口文件（用于「打开 Web 工作台」探活；目录按 .cache 优先）。 */
export function webServerInfoPaths(root: string): string[] {
  return [
    path.join(root, '.cache', 'web-server.json'),
    path.join(root, 'cache', 'web-server.json'),
  ];
}
