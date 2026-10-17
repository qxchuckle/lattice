import * as vscode from 'vscode';

/** 虚拟文档 URI 构造（scheme: lattice）。 */
export const LATTICE_SCHEME = 'lattice';

export function checkpointUri(taskId: string, checkpointId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: LATTICE_SCHEME, path: `/checkpoint/${taskId}/${checkpointId}` });
}

export function progressUri(taskId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: LATTICE_SCHEME, path: `/progress/${taskId}` });
}

export function reportUri(name: string): vscode.Uri {
  return vscode.Uri.from({ scheme: LATTICE_SCHEME, path: `/report/${name}` });
}

export function contextUri(
  target: { taskId?: string; projectId?: string },
  query?: string,
): vscode.Uri {
  const params = new URLSearchParams();
  if (target.taskId) params.set('task', target.taskId);
  if (target.projectId) params.set('project', target.projectId);
  if (query) params.set('query', query);
  return vscode.Uri.from({
    scheme: LATTICE_SCHEME,
    path: `/context/${target.taskId ?? target.projectId ?? 'current'}`,
    query: params.toString(),
  });
}
