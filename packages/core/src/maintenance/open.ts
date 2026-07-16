import { execFile } from 'node:child_process';
import { getLatticeRoot } from '../paths';

/** 打开方式 */
export type OpenMode = 'finder' | 'terminal';

/** 支持的编辑器/应用 */
export type EditorApp = 'vscode' | 'cursor' | 'qoder' | 'finder';

/** 编辑器命令映射 */
const EDITOR_COMMANDS: Record<EditorApp, string> = {
  vscode: 'code',
  cursor: 'cursor',
  qoder: 'qoder',
  finder: 'open',
};

/** 平台命令映射 */
function getOpenCommand(mode: OpenMode): { cmd: string; args: (path: string) => string[] } {
  if (mode === 'terminal') {
    if (process.platform === 'darwin') {
      return { cmd: 'open', args: (p) => ['-a', 'Terminal', p] };
    } else if (process.platform === 'win32') {
      return { cmd: 'cmd', args: (p) => ['/c', 'start', 'cmd', '/K', `cd /d ${p}`] };
    }
    return { cmd: 'x-terminal-emulator', args: (p) => [`--working-directory=${p}`] };
  }
  if (process.platform === 'darwin') {
    return { cmd: 'open', args: (p) => [p] };
  } else if (process.platform === 'win32') {
    return { cmd: 'explorer', args: (p) => [p] };
  }
  return { cmd: 'xdg-open', args: (p) => [p] };
}

/** 执行命令并返回 Promise（捕获 spawn 错误） */
function execAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * 在文件管理器或终端中打开指定目录。
 * 使用 execFile + callback，不走 shell，避免命令注入。
 */
export async function openDirectory(
  dirPath: string,
  mode: OpenMode = 'finder',
): Promise<{ success: boolean; message: string }> {
  const { cmd, args } = getOpenCommand(mode);
  try {
    await execAsync(cmd, args(dirPath));
    return { success: true, message: `已打开：${dirPath}` };
  } catch (err) {
    return { success: false, message: `打开失败: ${(err as Error).message}` };
  }
}

/**
 * 用指定编辑器打开文件或目录。
 * 使用 execFile + callback，不走 shell，避免命令注入。
 */
export async function openWithEditor(
  path: string,
  app: EditorApp,
): Promise<{ success: boolean; message: string }> {
  const command = EDITOR_COMMANDS[app];
  if (!command) {
    return { success: false, message: `不支持的应用: ${app}` };
  }
  try {
    await execAsync(command, [path]);
    return { success: true, message: `已用 ${app} 打开：${path}` };
  } catch (err) {
    return { success: false, message: `打开失败: ${(err as Error).message}` };
  }
}

/** 打开 Lattice 根目录的便捷方法 */
export async function openLatticeRoot(
  mode: OpenMode = 'finder',
): Promise<{ success: boolean; message: string }> {
  return openDirectory(getLatticeRoot(), mode);
}
