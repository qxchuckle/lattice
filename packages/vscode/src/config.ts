import * as vscode from 'vscode';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { expandHome } from './util/paths';

export interface LatticeConfig {
  cliPath: string;
  latticeHome: string;
  minCliVersion: string;
  autoRefresh: boolean;
  refreshDebounce: number;
  fallbackPollMs: number;
  cliTimeoutMs: number;
  tasksScope: 'all' | 'project';
  tasksShowArchived: boolean;
  searchTypes: string[];
  searchLimit: number;
  graphDefaultLayout: 'force' | 'sequential' | 'radial';
  graphKeepContext: boolean;
  statusBarProject: boolean;
  statusBarActiveTasks: boolean;
  statusBarUser: boolean;
  editorSpecLinks: boolean;
  decorationsEnabled: boolean;
  ragHintOnSave: boolean;
  specDiagnosticsEnabled: boolean;
  trace: boolean;
}

export function getConfig(): LatticeConfig {
  const c = vscode.workspace.getConfiguration('lattice');
  return {
    cliPath: c.get<string>('cliPath', ''),
    latticeHome: c.get<string>('latticeHome', ''),
    minCliVersion: c.get<string>('minCliVersion', '1.28.0'),
    autoRefresh: c.get<boolean>('autoRefresh', true),
    refreshDebounce: c.get<number>('refreshDebounce', 400),
    fallbackPollMs: c.get<number>('fallbackPollMs', 30000),
    cliTimeoutMs: c.get<number>('cliTimeoutMs', 20000),
    tasksScope: c.get<'all' | 'project'>('tasks.scope', 'all'),
    tasksShowArchived: c.get<boolean>('tasks.showArchived', true),
    searchTypes: c.get<string[]>('search.types', []),
    searchLimit: c.get<number>('search.limit', 0),
    graphDefaultLayout: c.get<'force' | 'sequential' | 'radial'>('graph.defaultLayout', 'force'),
    graphKeepContext: c.get<boolean>('graph.keepContext', false),
    statusBarProject: c.get<boolean>('statusBar.project', true),
    statusBarActiveTasks: c.get<boolean>('statusBar.activeTasks', true),
    statusBarUser: c.get<boolean>('statusBar.user', true),
    editorSpecLinks: c.get<boolean>('editor.specLinks', true),
    decorationsEnabled: c.get<boolean>('decorations.enabled', true),
    ragHintOnSave: c.get<boolean>('documents.ragHintOnSave', true),
    specDiagnosticsEnabled: c.get<boolean>('specDiagnostics.enabled', true),
    trace: c.get<boolean>('trace', false),
  };
}

export function onConfigChanged(
  listener: (event: vscode.ConfigurationChangeEvent) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('lattice')) listener(event);
  });
}

/** Lattice 数据根目录：设置 latticeHome > LATTICE_HOME 环境变量 > ~/.lattice（与 CLI 优先级一致）。 */
export function getLatticeRoot(): string {
  const cfg = getConfig();
  if (cfg.latticeHome.trim()) {
    return expandHome(cfg.latticeHome.trim(), homedir());
  }
  const envHome = process.env.LATTICE_HOME?.trim();
  if (envHome) return path.resolve(envHome);
  return path.join(homedir(), '.lattice');
}

/** 传给 ltc 子进程的环境变量：设置覆盖时注入 LATTICE_HOME，保证 CLI 与扩展看到同一数据根。 */
export function getCliEnv(): NodeJS.ProcessEnv {
  const cfg = getConfig();
  if (cfg.latticeHome.trim()) {
    return { ...process.env, LATTICE_HOME: getLatticeRoot() };
  }
  return process.env;
}
